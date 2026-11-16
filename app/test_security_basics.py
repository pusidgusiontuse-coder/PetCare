"""Adversarial access, upload and authentication regression tests."""
import base64
from datetime import date, datetime, timedelta
from io import BytesIO
import json
import uuid

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter

import main, models
from database import SessionLocal
from test_security_features import user, pet, valid_image
from connection_config import validate_url


@pytest.fixture
def client():
    # A separate client IP prevents rate-limit tests affecting unrelated tests.
    address = '198.51.100.' + str((uuid.uuid4().int % 240) + 1)
    return TestClient(main.app, client=(address, 50000))


CREATES = [
    ('health-records', {'record_type':'other','event_date':'2026-11-16','title':'Осмотр'}),
    ('weights', {'date':'2026-11-16','kg':3.5}),
    ('prescriptions', {'name':'Лекарство','start_date':'2026-11-16'}),
    ('meal-plans', {'food':'Корм','time':'10:00'}),
    ('feeding-logs', {'food':'Корм'}),
    ('nutrition', {'food_name':'Корм'}),
    ('reminders', {'title':'Уход','due_date':'2026-11-16'}),
    ('documents', {'title':'Паспорт','date':'2026-11-16'}),
    ('shopping', {'title':'Корм'}),
    ('activity', {'action':'Изменение'}),
]

@pytest.mark.parametrize('path,payload', CREATES)
@pytest.mark.parametrize('role', ['viewer', 'unknown', 'stranger', 'expired'])
def test_no_write_without_explicit_editor_access(client, path, payload, role):
    owner, visitor = user(), user()
    p=pet(client, owner[2])
    baseline=client.post(f"/api/v1/pets/{p['id']}/{path}",headers=owner[2],json=payload)
    assert baseline.status_code==201,baseline.text
    if role != 'stranger':
        with SessionLocal() as db:
            db.add(models.PetMember(pet_id=p['id'],user_id=visitor[0],role='editor' if role=='expired' else role,
                                   expires_at=datetime.utcnow()-timedelta(days=1) if role=='expired' else None))
            db.commit()
    response=client.post(f"/api/v1/pets/{p['id']}/{path}",headers=visitor[2],json=payload)
    assert response.status_code in (403,404), response.text


def test_document_read_download_delete_and_undo_authorization(client):
    owner, viewer, outsider = user(), user(), user()
    p=pet(client,owner[2]); pid=p['id']
    with SessionLocal() as db:
        db.add(models.PetMember(pet_id=pid,user_id=viewer[0],role='viewer')); db.commit()
    created=client.post(f'/api/v1/pets/{pid}/documents',headers=owner[2],json={
        'title':'Записка','date':'2026-11-16','file_name':'note.txt','file_data':'data:text/plain;base64,aGk='})
    assert created.status_code==201,created.text
    doc_id=created.json()['id']
    url=f'/api/v1/documents/{doc_id}/download'
    assert client.get(url).status_code in (401,403)
    assert client.get(url,headers=outsider[2]).status_code in (403,404)
    assert client.get(f'/api/v1/pets/{pid}/documents',headers=outsider[2]).status_code in (403,404)
    result=client.get(url,headers=viewer[2]); assert result.status_code==200
    assert result.content==b'hi' and 'attachment' in result.headers['content-disposition']
    assert result.headers['x-content-type-options']=='nosniff'
    assert client.delete(f'/api/v1/documents/{doc_id}',headers=viewer[2]).status_code in (403,404)
    undo=client.delete(f'/api/v1/documents/{doc_id}',headers=owner[2]).json()['undo_token']
    assert client.post(f'/api/v1/actions/{undo}/undo',headers=viewer[2]).status_code==400
    assert client.post(f'/api/v1/actions/{undo}/undo',headers=owner[2]).status_code==200
    with SessionLocal() as db:
        member=db.query(models.PetMember).filter_by(pet_id=pid,user_id=viewer[0]).one()
        member.expires_at=datetime.utcnow()-timedelta(seconds=1); db.commit()
    assert client.get(url,headers=viewer[2]).status_code in (403,404)


def test_only_owner_receives_invitation_capability(client):
    owner, editor=user(),user();p=pet(client,owner[2]);pid=p['id']
    with SessionLocal() as db:
        db.add(models.PetMember(pet_id=pid,user_id=editor[0],role='editor'));db.commit()
    assert client.get(f'/api/v1/pets/{pid}',headers=editor[2]).json()['share_code'] is None
    assert client.get('/api/v1/pets',headers=editor[2]).json()[0]['share_code'] is None
    assert client.get(f'/api/v1/pets/{pid}',headers=owner[2]).json()['share_code']==p['share_code']
    assert client.post(f'/api/v1/pets/{pid}/rotate-code',headers=editor[2]).status_code==403


def test_foreign_feeding_reference_is_rejected(client):
    owner=user();p1=pet(client,owner[2]);p2=pet(client,owner[2])
    plan=client.post(f"/api/v1/pets/{p1['id']}/meal-plans",headers=owner[2],json={'food':'Корм','time':'12:00'}).json()
    r=client.post(f"/api/v1/pets/{p2['id']}/feeding-logs",headers=owner[2],json={'food':'Корм','meal_plan_id':plan['id']})
    assert r.status_code==404


def test_account_throttle_cannot_be_bypassed_by_changing_ip(client):
    account=user()
    for _ in range(10):
        r=client.post('/api/v1/auth/login',json={'email':account[1],'password':'wrong-password'})
        assert r.status_code==401
    other=TestClient(main.app,client=('203.0.113.99',50000))
    r=other.post('/api/v1/auth/login',headers={'X-Forwarded-For':'192.0.2.100'},json={'email':account[1].upper(),'password':'test-password'})
    assert r.status_code==429
    assert 'password' not in r.text


@pytest.mark.parametrize('value,name', [
    ('data:text/html;base64,PHNjcmlwdD4=', 'x.html'),
    ('javascript:alert(1)', 'x.pdf'),
    ('data:image/png;base64,iVBORw0KGgo=', 'x.png'),
    ('data:image/png;base64,%%%%', 'x.png'),
    ('data:text/plain;base64,aGk=', 'x.exe'),
])
def test_invalid_documents_are_rejected(client,value,name):
    account=user();p=pet(client,account[2])
    r=client.post(f"/api/v1/pets/{p['id']}/documents",headers=account[2],json={
        'title':'Документ','date':'2026-11-16','file_name':name,'file_data':value})
    assert r.status_code==422,r.text
    assert value not in r.text


def test_pdf_active_content_is_rejected(client):
    account=user();p=pet(client,account[2])
    writer=PdfWriter();writer.add_blank_page(width=100,height=100);writer.add_open_action(__import__('pypdf.actions',fromlist=['JavaScript']).JavaScript('app.alert("bad")'))
    data=BytesIO();writer.write(data)
    value='data:application/pdf;base64,'+base64.b64encode(data.getvalue()).decode()
    r=client.post(f"/api/v1/pets/{p['id']}/documents",headers=account[2],json={
        'title':'Документ','date':'2026-11-16','file_name':'x.pdf','file_data':value})
    assert r.status_code==422


def test_valid_document_and_filename_normalization(client):
    account=user();p=pet(client,account[2]);image=valid_image()
    value='data:image/png;base64,'+base64.b64encode(image).decode()
    r=client.post(f"/api/v1/pets/{p['id']}/documents",headers=account[2],json={
        'title':'Фото','date':'2026-11-16','file_name':'../../photo.png','file_data':value})
    assert r.status_code==201,r.text
    assert r.json()['file_name']=='photo.png'


def test_body_limit_and_secret_redaction(client):
    r=client.post('/api/v1/auth/login',content=b'x'*(16*1024+1),headers={'content-type':'application/json'})
    assert r.status_code==413
    secret='private-password-'+uuid.uuid4().hex
    r=client.post('/api/v1/auth/login',json={'email':'x','password':{'secret':secret}})
    assert r.status_code==422 and secret not in r.text


def test_security_headers_and_no_private_cache(client):
    r=client.get('/')
    assert r.headers['x-frame-options']=='DENY'
    assert r.headers['x-content-type-options']=='nosniff'
    assert r.headers['cache-control']=='no-store'
    assert client.get('/static/frontend/index.html').headers['content-security-policy']==r.headers['content-security-policy']
    assert "script-src 'self'" in r.headers['content-security-policy']
    assert "'unsafe-inline'" not in r.headers['content-security-policy'].split('script-src ')[1].split(';')[0]
    assert client.get('/api/v1/health').headers['cache-control']=='no-store'


@pytest.mark.parametrize('url',[
    'sqlite:///local.db', 'postgresql://app:password@db.internal/petcare',
    'postgresql://app:password@db.internal/petcare?sslmode=require',
    'postgresql://app:password@localhost/petcare?host=evil.example',
])
def test_unsafe_production_database_connection_rejected(url):
    with pytest.raises(RuntimeError): validate_url(url,True)


def test_unknown_membership_cannot_read_lists_or_join(client):
    owner,visitor=user(),user();p=pet(client,owner[2])
    with SessionLocal() as db:
        db.add(models.PetMember(pet_id=p['id'],user_id=visitor[0],role='unknown'));db.commit()
    assert client.get('/api/v1/pets',headers=visitor[2]).json()==[]
    assert client.get('/api/v1/reminders',headers=visitor[2]).json()==[]
    assert client.post('/api/v1/pets/join-by-code',headers=visitor[2],json={'invite_code':p['share_code']}).status_code==403


def test_invalid_unicode_does_not_crash_login(client):
    for payload in ({'email':'x@example.com','password':'\ud800'}, {'email':'\ud800@example.com','password':'wrong'}):
        response=client.post('/api/v1/auth/login',content=json.dumps(payload),headers={'content-type':'application/json'})
        assert response.status_code in (401,422)


@pytest.mark.parametrize('path,payload', CREATES[:-1])
@pytest.mark.parametrize('role',['viewer','stranger'])
def test_cannot_delete_another_pets_records(client,path,payload,role):
    owner,visitor=user(),user();p=pet(client,owner[2])
    if role=='viewer':
        with SessionLocal() as db:
            db.add(models.PetMember(pet_id=p['id'],user_id=visitor[0],role='viewer'));db.commit()
    created=client.post(f"/api/v1/pets/{p['id']}/{path}",headers=owner[2],json=payload)
    assert created.status_code==201,created.text
    record_id=created.json()['id']
    response=client.delete(f'/api/v1/{path}/{record_id}',headers=visitor[2])
    assert response.status_code in (403,404),response.text
    relation={'health-records':'health_records','meal-plans':'meal_plans','feeding-logs':'feeding_logs','nutrition':'nutrition_logs','shopping':'shopping_items'}.get(path,path)
    card=client.get(f"/api/v1/pets/{p['id']}",headers=owner[2]).json()
    assert any(row['id']==record_id for row in card[relation])


@pytest.mark.parametrize('path,payload,suffix',[
    ('meal-plans',{'food':'Корм','time':'12:00'},'toggle'),
    ('shopping',{'title':'Корм'},'toggle'),
    ('reminders',{'title':'Уход','due_date':'2026-11-16'},'complete'),
])
def test_viewer_cannot_toggle_existing_records(client,path,payload,suffix):
    owner,viewer=user(),user();p=pet(client,owner[2])
    with SessionLocal() as db:
        db.add(models.PetMember(pet_id=p['id'],user_id=viewer[0],role='viewer'));db.commit()
    created=client.post(f"/api/v1/pets/{p['id']}/{path}",headers=owner[2],json=payload)
    assert created.status_code==201
    url=f"/api/v1/{path}/{created.json()['id']}/{suffix}"
    assert client.patch(url,headers=viewer[2],json={}).status_code in (403,404)
    assert client.patch(url,headers=owner[2],json={}).status_code==200


def test_unsafe_legacy_file_urls_are_not_exposed(client):
    owner=user();p=pet(client,owner[2])
    with SessionLocal() as db:
        db.add(models.Document(pet_id=p['id'],title='Старое вложение',date=date.today(),file_data='javascript:alert(1)'));db.commit()
    docs=client.get(f"/api/v1/pets/{p['id']}/documents",headers=owner[2]).json()
    assert docs[0]['file_data'] is None


def test_valid_pdf_without_active_content_accepted(client):
    owner=user();p=pet(client,owner[2])
    writer=PdfWriter();writer.add_blank_page(width=100,height=100)
    data=BytesIO();writer.write(data)
    value='data:application/pdf;base64,'+base64.b64encode(data.getvalue()).decode()
    r=client.post(f"/api/v1/pets/{p['id']}/documents",headers=owner[2],json={'title':'Документ','date':'2026-11-16','file_name':'note.pdf','file_data':value})
    assert r.status_code==201,r.text


def test_invalid_unicode_registration_is_rejected(client):
    response=client.post('/api/v1/auth/register',content=json.dumps({
        'full_name':'Test','email':'unicode@example.com','password':'password-\ud800'}),headers={'content-type':'application/json'})
    assert response.status_code==422
