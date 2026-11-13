import os,re,tempfile,uuid,json
from datetime import datetime,timedelta,date
from pathlib import Path
from unittest.mock import AsyncMock,patch
# Tests always use an isolated database, never application/user data.
_tmp=tempfile.TemporaryDirectory()
os.environ['DATABASE_URL']='sqlite:///'+str(Path(_tmp.name)/'test.db')
os.environ.setdefault('SECRET_KEY','isolated-test-key-not-for-production-at-least-32-characters')
os.environ['ENABLE_DEMO_LOGIN']='true'
import pytest
from fastapi.testclient import TestClient
import main,models,features,auth,ocr
from database import SessionLocal

@pytest.fixture
def client(): return TestClient(main.app)

@pytest.fixture
def mail(monkeypatch):
    sent=[]
    monkeypatch.setattr(features,'send_email',lambda address,subject,body:sent.append((address,body)))
    return sent

def user(admin=False,paid=False):
    with SessionLocal() as db:
        u=models.User(full_name='Test',email=uuid.uuid4().hex+'@example.com',hashed_password=auth.get_password_hash('test-password'),email_verified=True,is_admin=admin,premium_permanent=paid)
        db.add(u);db.commit();db.refresh(u); uid,email=u.id,u.email
    return uid,email,{'Authorization':'Bearer '+auth.create_access_token({'sub':str(uid)})}

def pet(client,h):
    r=client.post('/api/v1/pets',headers=h,json={'name':'Лапа','species':'Кошка','birth_date':'2024-01-01','breed':'Домашняя'})
    assert r.status_code==201,r.text
    return r.json()

def code(mail): return re.search(r'\b\d{6}\b',mail[-1][1]).group()

def test_registration_requires_valid_email_code(client,mail):
    email=uuid.uuid4().hex+'@example.com'
    r=client.post('/api/v1/auth/register',json={'full_name':'Илья','email':email,'password':'password-123'})
    assert r.status_code==200 and 'access_token' not in r.json()
    cid=r.json()['challenge_id']
    payload={'challenge_id':cid,'code':code(mail)}
    r=client.post('/api/v1/auth/confirm',json=payload);assert r.status_code==200,r.text
    assert r.json()['user']['email_verified']
    assert client.post('/api/v1/auth/confirm',json=payload).status_code==400

def test_code_five_attempts_and_expiry(client,mail):
    uid,email,h=user()
    r=client.post('/api/v1/auth/codes',json={'email':email});cid=r.json()['challenge_id'];correct=code(mail)
    wrong='111111' if correct!='111111' else '222222'
    for i in range(5):assert client.post('/api/v1/auth/confirm',json={'challenge_id':cid,'code':wrong,'new_password':'new-password'}).status_code==400
    assert client.post('/api/v1/auth/confirm',json={'challenge_id':cid,'code':correct,'new_password':'new-password'}).status_code==400

def test_password_reset_revokes_old_sessions(client,mail):
    uid,email,h=user();r=client.post('/api/v1/auth/codes',json={'email':email})
    r=client.post('/api/v1/auth/confirm',json={'challenge_id':r.json()['challenge_id'],'code':code(mail),'new_password':'new-password'})
    assert r.status_code==200,r.text
    assert client.get('/api/v1/auth/me',headers=h).status_code==401
    assert client.post('/api/v1/auth/login',json={'email':email.upper(),'password':'new-password'}).status_code==200

def test_sensitive_changes_not_allowed_via_profile(client):
    uid,email,h=user()
    assert client.put('/api/v1/auth/user',headers=h,json={'password':'stolen-password'}).status_code==400
    assert client.put('/api/v1/auth/user',headers=h,json={'email':'other@example.com'}).status_code==400

def test_account_code_requires_password_and_change_email(client,mail):
    uid,email,h=user();target=uuid.uuid4().hex+'@example.com'
    assert client.post('/api/v1/auth/account-codes',headers=h,json={'email':email,'purpose':'email_change','new_email':target,'current_password':'bad'}).status_code==403
    r=client.post('/api/v1/auth/account-codes',headers=h,json={'email':email,'purpose':'email_change','new_email':target,'current_password':'test-password'})
    result=client.post('/api/v1/auth/confirm',json={'challenge_id':r.json()['challenge_id'],'code':code(mail)})
    assert result.status_code==200,result.text
    assert result.json()['user']['email']==target
    assert mail[-1][0]==email # old address notified
    assert client.get('/api/v1/auth/me',headers=h).status_code==401

def test_session_revoke(client):
    uid,email,h=user();r=client.get('/api/v1/auth/sessions',headers=h);sid=r.json()[0]['id']
    other=user()[2]
    assert client.delete('/api/v1/auth/sessions/'+sid,headers=other).status_code==404
    assert client.delete('/api/v1/auth/sessions/'+sid,headers=h).status_code==200
    assert client.get('/api/v1/auth/me',headers=h).status_code==401

def test_member_permissions_expiration_and_revoke(client):
    owner=user();viewer=user();p=pet(client,owner[2]);pid=p['id']
    r=client.post(f'/api/v1/pets/{pid}/members',headers=owner[2],json={'email':viewer[1],'role':'viewer'});assert r.status_code==200,r.text
    assert client.get(f'/api/v1/pets/{pid}',headers=viewer[2]).status_code==200
    assert client.patch(f'/api/v1/pets/{pid}',headers=viewer[2],json={'name':'Wrong'}).status_code==403
    r=client.post(f'/api/v1/pets/{pid}/health-records',headers=viewer[2],json={'record_type':'other','event_date':'2026-01-01','title':'test'})
    assert r.status_code==403,r.text
    assert client.post(f'/api/v1/pets/{pid}/members',headers=viewer[2],json={'email':owner[1]}).status_code==403
    members=client.get(f'/api/v1/pets/{pid}/members',headers=owner[2]).json()
    assert client.delete(f'/api/v1/pets/{pid}/members/'+str(members[0]['id']),headers=owner[2]).status_code==200
    assert client.get(f'/api/v1/pets/{pid}',headers=viewer[2]).status_code==403

def test_expired_members_not_listed(client):
    owner=user();viewer=user();p=pet(client,owner[2])
    with SessionLocal() as db:
        db.add(models.PetMember(pet_id=p['id'],user_id=viewer[0],role='editor',expires_at=datetime.utcnow()-timedelta(seconds=1)));db.commit()
    assert client.get('/api/v1/pets',headers=viewer[2]).json()==[]
    assert client.get('/api/v1/pets/'+str(p['id']),headers=viewer[2]).status_code==403

def test_rotate_code(client):
    owner=user();v=user();p=pet(client,owner[2])
    r=client.post(f"/api/v1/pets/{p['id']}/rotate-code",headers=owner[2]);assert r.status_code==200
    assert client.post('/api/v1/pets/join-by-code',headers=v[2],json={'invite_code':p['share_code']}).status_code==404

def test_document_undo_is_persistent_and_owner_bound(client):
    uid,email,h=user();p=pet(client,h)
    r=client.post(f"/api/v1/pets/{p['id']}/documents",headers=h,json={'title':'Паспорт','doc_type':'passport','date':'2026-01-01','file_data':'data:text/plain;base64,aGk='})
    assert r.status_code==201,r.text
    token=client.delete('/api/v1/documents/'+str(r.json()['id']),headers=h).json()['undo_token']
    assert client.post('/api/v1/actions/'+token+'/undo',headers=user()[2]).status_code==400
    assert client.post('/api/v1/actions/'+token+'/undo',headers=h).status_code==200
    assert len(client.get(f"/api/v1/pets/{p['id']}/documents",headers=h).json())==1
    assert client.post('/api/v1/actions/'+token+'/undo',headers=h).status_code==400

def test_preferences_persist_per_account(client):
    h=user()[2];other=user()[2]
    assert client.put('/api/v1/notifications/settings',headers=h,json={'quietEnabled':True,'quietStart':'23:00','quietEnd':'07:00','types':['Препарат']}).status_code==200
    assert client.get('/api/v1/notifications/settings',headers=h).json()['quietEnabled']
    assert not client.get('/api/v1/notifications/settings',headers=other).json()['quietEnabled']
    assert client.put('/api/v1/notifications/settings',headers=h,json={'quietStart':'99:10'}).status_code==422

def test_push_ssrf_blocked(client):
    assert client.post('/api/v1/notifications/subscribe',headers=user()[2],json={'endpoint':'https://127.0.0.1/private','keys':{'auth':'x','p256dh':'x'}}).status_code==422

def test_free_limit_and_admin_entitlements(client):
    uid,email,h=user();admin=user(admin=True)
    for _ in range(3):pet(client,h)
    r=client.post('/api/v1/pets',headers=h,json={'name':'Fourth','species':'Кот','birth_date':'2024-01-01'})
    assert r.status_code==403,r.text
    assert client.get('/api/v1/admin/users',headers=h).status_code==403
    assert client.patch(f'/api/v1/admin/users/{uid}/premium',headers=h,json={'enabled':True}).status_code==403
    assert client.patch(f'/api/v1/admin/users/{uid}/premium',headers=admin[2],json={'enabled':True,'days':30}).status_code==200
    pet(client,h)
    assert client.get('/api/v1/billing/status',headers=h).json()['premium']

def test_admin_block_revoke_and_no_promotion(client):
    uid,email,h=user();admin=user(admin=True)
    assert client.patch(f'/api/v1/admin/users/{uid}/blocked',headers=admin[2],json={'blocked':True}).status_code==200
    assert client.get('/api/v1/auth/me',headers=h).status_code==401
    assert client.post('/api/v1/auth/login',json={'email':email,'password':'test-password'}).status_code==401
    assert client.get('/api/v1/admin/audit',headers=admin[2]).json()
    assert client.patch(f'/api/v1/admin/users/{admin[0]}/blocked',headers=admin[2],json={'blocked':True}).status_code==400

def test_ocr_requires_paid_access(client):
    r=client.post('/api/v1/documents/recognize',headers=user()[2],files={'file':('a.png',b'abc','image/png')})
    assert r.status_code==403,r.text

def test_no_paid_ocr_and_missing_key(monkeypatch):
    import asyncio
    monkeypatch.delenv('OCR_API_KEY',raising=False)
    with pytest.raises(Exception) as e:asyncio.run(ocr.recognize_text(b'x','image/png'))
    assert e.value.status_code==503
    monkeypatch.setenv('OCR_API_KEY','fake');monkeypatch.setenv('OCR_MODEL','paid-model')
    with pytest.raises(Exception) as e:asyncio.run(ocr.recognize_text(b'x','image/png'))
    assert e.value.status_code==503

def test_missing_ocr_configuration_does_not_consume_quota(client, monkeypatch):
    monkeypatch.delenv('OCR_API_KEY', raising=False)
    account_id, _, headers = user(paid=True)
    with SessionLocal() as db:
        before = db.query(models.RequestQuota).count()
    for _ in range(2):
        response = client.post('/api/v1/documents/recognize', headers=headers,
                               files={'file': ('document.png', b'\x89PNG\r\n\x1a\n', 'image/png')})
        assert response.status_code == 503
        assert 'OpenRouter' in response.json()['detail']
    with SessionLocal() as db:
        assert db.query(models.RequestQuota).count() == before

def test_pwa_resources_and_no_private_cache(client):
    assert client.get('/manifest.webmanifest').json()['display']=='standalone'
    for size in (180,192,512):assert client.get(f'/static/icon-{size}.png').status_code==200
    sw=client.get('/sw.js');assert sw.status_code==200
    assert 'no-cache' in sw.headers['cache-control']
    assert '/api/v1' not in sw.text

def test_demo_login_bypass_removed(client):
    for email in ('demo1@petcare.app','demo2@petcare.local'):
        assert client.post('/api/v1/auth/login',json={'email':email,'password':'wrong'}).status_code==401

def test_export_excludes_credentials(client):
    uid,email,h=user();pet(client,h)
    r=client.get('/api/v1/account/export',headers=h)
    assert r.status_code==200 and len(r.json()['pets'])==1
    assert 'hashed_password' not in r.text and 'token_version' not in r.text

def test_notification_repeat_dates():
    from notifications import due_occurrence,MSK
    r=models.Reminder(title='x',due_date=date(2026,1,31),due_time='09:00',interval_months=1,status='pending')
    assert due_occurrence(r,datetime(2026,2,28,9,1,tzinfo=MSK)).day==28

def test_recurring_event_undo_removes_next_occurrence(client):
    uid,email,h=user();p=pet(client,h)
    r=client.post(f"/api/v1/pets/{p['id']}/reminders",headers=h,json={'title':'Прививка','reminder_type':'procedure','due_date':'2026-01-31','at':'2026-01-31T09:00:00+03:00','interval_months':1})
    assert r.status_code==201,r.text
    rid=r.json()['id'];r=client.patch(f'/api/v1/reminders/{rid}/action',headers=h,json={'status':'completed'})
    assert r.status_code==200,r.text
    token=r.json()['undo_token'];assert token
    rows=client.get('/api/v1/reminders',headers=h).json()
    assert len(rows)==2
    assert any(x['due_date']=='2026-02-28' for x in rows)
    assert client.post('/api/v1/actions/'+token+'/undo',headers=h).status_code==200
    rows=client.get('/api/v1/reminders',headers=h).json()
    assert len(rows)==1 and rows[0]['status']=='pending'

def test_expired_email_code(client,mail):
    uid,email,h=user();r=client.post('/api/v1/auth/codes',json={'email':email});cid=r.json()['challenge_id']
    with SessionLocal() as db:db.get(models.EmailChallenge,cid).expires_at=datetime.utcnow()-timedelta(seconds=1);db.commit()
    assert client.post('/api/v1/auth/confirm',json={'challenge_id':cid,'code':code(mail),'new_password':'new-password'}).status_code==400

def test_unknown_email_is_generic_and_sends_nothing(client,mail):
    r=client.post('/api/v1/auth/codes',json={'email':uuid.uuid4().hex+'@example.com'})
    assert r.status_code==200 and 'challenge_id' in r.json() and not mail

def test_ocr_transcription_and_free_metadata(monkeypatch):
    import asyncio,httpx
    monkeypatch.setenv('OCR_API_KEY','test-key');monkeypatch.setenv('OCR_MODEL','test/vision:free')
    response=httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':'Рукописная запись: [неразборчиво]'}}]},request=httpx.Request('POST','https://openrouter.ai/api/v1/chat/completions'))
    catalog=httpx.Response(200,json={'data':[{'id':'test/vision:free','architecture':{'input_modalities':['text','image']},'pricing':{'prompt':'0','completion':'0','image':'0'}}]},request=httpx.Request('GET','https://openrouter.ai/api/v1/models'))
    mock=AsyncMock();mock.get.return_value=catalog;mock.post.return_value=response
    with patch('ocr.httpx.AsyncClient') as factory:
        factory.return_value.__aenter__.return_value=mock
        assert '[неразборчиво]' in asyncio.run(ocr.recognize_text(b'image','image/png'))
    body=mock.post.call_args.kwargs['json'];assert body['model'].endswith(':free') and body['provider']['allow_fallbacks'] is False
    assert 'дозировки' in body['messages'][0]['content']

def test_ocr_nonzero_pricing_stops_before_image_sent(monkeypatch):
    import asyncio,httpx
    monkeypatch.setenv('OCR_API_KEY','test');monkeypatch.setenv('OCR_MODEL','test/vision:free')
    catalog=httpx.Response(200,json={'data':[{'id':'test/vision:free','architecture':{'input_modalities':['image']},'pricing':{'prompt':'0.01','completion':'0'}}]},request=httpx.Request('GET','https://openrouter.ai/api/v1/models'))
    mock=AsyncMock();mock.get.return_value=catalog
    with patch('ocr.httpx.AsyncClient') as factory:
        factory.return_value.__aenter__.return_value=mock
        with pytest.raises(Exception) as e:asyncio.run(ocr.recognize_text(b'image','image/png'))
        assert e.value.status_code==503
    mock.post.assert_not_called()

def test_bootstrap_creates_one_admin_pet_without_overwriting_password(client):
    from bootstrap_admin import bootstrap
    with SessionLocal() as db:
        old=db.query(models.User).filter(models.User.is_admin==True).all()
        for u in old:u.is_admin=False
        db.commit()
    bootstrap({'login':'petcare-admin','password':'Lapa-47-More'})
    r=client.post('/api/v1/auth/login',json={'email':'petcare-admin','password':'Lapa-47-More'})
    assert r.status_code==200,r.text
    assert r.json()['user']['is_admin'] and r.json()['user']['premium']
    h={'Authorization':'Bearer '+r.json()['access_token']};assert len(client.get('/api/v1/pets',headers=h).json())==1
    bootstrap({'login':'petcare-admin','password':'different-password'})
    assert client.post('/api/v1/auth/login',json={'email':'petcare-admin','password':'Lapa-47-More'}).status_code==200

def test_background_push_deduplicates_without_open_browser(client,monkeypatch):
    from notifications import run,MSK
    uid,email,h=user();p=pet(client,h)
    with SessionLocal() as db:
        db.add(models.Reminder(pet_id=p['id'],title='Погулять',reminder_type='walk',due_date=date(2026,11,13),at='2026-11-13T15:00:00+03:00',status='pending'))
        db.add(models.PushSubscription(user_id=uid,endpoint='https://fcm.googleapis.com/test-'+str(uid),data='{}'));db.commit()
    monkeypatch.setenv('VAPID_PRIVATE_KEY','test-key')
    with patch('pywebpush.webpush') as send:
        run(datetime(2026,11,13,15,1,tzinfo=MSK));run(datetime(2026,11,13,15,2,tzinfo=MSK))
        assert send.call_count==1
