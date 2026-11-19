"""Regression tests for account controls and the separate admin surface."""
from datetime import datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

import auth
from database import SessionLocal
import main
import models
from test_security_features import user
from login_guard import account_key


def test_lock_expires_and_correct_password_resets_streak(monkeypatch):
    uid, email, _ = user()
    monkeypatch.setattr(auth, 'verify_password', lambda candidate, _: candidate == 'test-password')
    client = TestClient(main.app, client=('203.0.113.151', 50000))
    login = lambda password: client.post('/api/v1/auth/login', json={'email': email, 'password': password})
    assert [login('wrong').status_code for _ in range(5)] == [401, 401, 401, 401, 429]
    assert login('test-password').status_code == 429
    with SessionLocal() as db:
        state = db.get(models.LoginGuard, account_key(f'user:{uid}'))
        state.blocked_until = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
    assert login('test-password').status_code == 200
    assert [login('wrong').status_code for _ in range(4)] == [401] * 4
    assert login('test-password').status_code == 200
    assert login('wrong').status_code == 401


def test_ip_block_persists_across_accounts_and_admin_can_remove_it(monkeypatch):
    _, email, _ = user()
    _, _, admin = user(admin=True)
    monkeypatch.setattr(auth, 'verify_password', lambda candidate, _: candidate == 'test-password')
    ip = '203.0.113.152'
    client = TestClient(main.app, client=(ip, 50000))
    try:
        assert client.patch('/api/v1/admin/settings', json={'support_contact': 'help@example.test'}, headers=admin).status_code == 200
        assert client.get('/api/v1/auth/support').json()['support_contact'] == 'help@example.test'
        for attempt in range(50):
            response = client.post('/api/v1/auth/login', headers={'X-Forwarded-For': f'198.51.100.{attempt+1}'},
                                   json={'email': uuid4().hex + '@example.test', 'password': 'wrong'})
            assert response.status_code == (403 if attempt == 49 else 401)
        assert response.json()['detail']['support_contact'] == 'help@example.test'
        response = client.post('/api/v1/auth/login', json={'email': email, 'password': 'test-password'})
        assert response.status_code == 403
        assert response.json()['detail']['reason'] == 'ip_blocked'
        confirm = client.post('/api/v1/auth/confirm', json={'challenge_id': 'placeholder', 'code': '123456'})
        assert confirm.status_code == 403
        assert ip in [row['ip_address'] for row in client.get('/api/v1/admin/blocked-ips', headers=admin).json()['ips']]
        assert client.delete('/api/v1/admin/blocked-ips/' + ip, headers=admin).status_code == 200
        assert client.post('/api/v1/auth/login', json={'email': email, 'password': 'test-password'}).status_code == 200
    finally:
        client.patch('/api/v1/admin/settings', json={'support_contact': ''}, headers=admin)


def test_admin_create_roles_and_real_session_addresses():
    _, _, admin = user(admin=True)
    _, _, regular = user()
    client = TestClient(main.app, client=('203.0.113.153', 50000))
    email = uuid4().hex + '@example.test'
    payload = {'email': email, 'full_name': 'Аккаунт администратора', 'password': 'temporary-password'}
    assert client.post('/api/v1/admin/users', json=payload, headers=regular).status_code == 403
    response = client.post('/api/v1/admin/users', json=payload, headers=admin)
    assert response.status_code == 201
    created = response.json()
    assert not created['email_verified']
    assert not created['is_admin']
    account = '/api/v1/admin/users/' + str(created['id'])

    def login():
        result = client.post('/api/v1/auth/login', headers={'User-Agent': 'Test Browser', 'X-Forwarded-For': '192.0.2.7'},
                             json={'email': email, 'password': 'temporary-password'})
        assert result.status_code == 200
        return {'Authorization': 'Bearer ' + result.json()['access_token']}

    old = login()
    assert client.get(account + '/sessions', headers=regular).status_code == 403
    entry = client.get(account + '/sessions', headers=admin).json()['sessions'][0]
    assert entry['ip_address'] == '203.0.113.153'
    assert entry['device'] == 'Test Browser'
    assert entry['active']
    assert client.patch(account + '/role', json={'is_admin': True}, headers=regular).status_code == 403
    assert client.patch(account + '/role', json={'is_admin': True}, headers=admin).status_code == 200
    assert client.get('/api/v1/admin/status', headers=old).status_code == 401
    promoted = login()
    assert client.get('/api/v1/admin/status', headers=promoted).status_code == 200
    assert client.patch(account + '/role', json={'is_admin': False}, headers=promoted).status_code == 400
    assert client.patch(account + '/role', json={'is_admin': False}, headers=admin).status_code == 200
    assert client.get('/api/v1/admin/status', headers=promoted).status_code == 401


def test_admin_can_reset_password_and_invalidate_codes(monkeypatch):
    import re
    import features

    _, _, admin = user(admin=True)
    uid, email, regular = user()
    sent = []
    monkeypatch.setattr(features, 'send_email', lambda address, subject, body: sent.append(body))
    client = TestClient(main.app, client=('203.0.113.154', 50000))
    challenge = client.post('/api/v1/auth/codes', json={'email': email}).json()['challenge_id']
    code = re.search(r'\b\d{6}\b', sent[0]).group()
    path = f'/api/v1/admin/users/{uid}/password'
    payload = {'current_password': 'test-password', 'new_password': 'changed-by-admin-24'}
    assert client.patch(path, headers=regular, json=payload).status_code == 403
    assert client.patch(path, headers=admin, json={**payload, 'current_password': 'wrong'}).status_code == 403
    assert client.get('/api/v1/auth/me', headers=regular).status_code == 200
    assert client.patch(path, headers=admin, json=payload).json() == {'status': 'ok'}
    assert client.get('/api/v1/auth/me', headers=regular).status_code == 401
    assert client.post('/api/v1/auth/confirm', json={
        'challenge_id': challenge, 'code': code, 'new_password': 'stale-code-password',
    }).status_code == 400
    assert client.post('/api/v1/auth/login', json={'email': email, 'password': 'test-password'}).status_code == 401
    assert client.post('/api/v1/auth/login', json={'email': email, 'password': payload['new_password']}).status_code == 200
    assert any(item['action'] == 'change_password' and item['target_id'] == uid
               for item in client.get('/api/v1/admin/audit', headers=admin).json())


def test_admin_can_edit_and_delete_account_with_confirmation():
    from test_security_features import pet

    admin_id, admin_email, admin = user(admin=True)
    uid, email, regular = user()
    client = TestClient(main.app, client=('203.0.113.155', 50000))
    owned = pet(client, regular)
    path = f'/api/v1/admin/users/{uid}'
    new_email = uuid4().hex + '@example.test'
    credentials = {'current_password': 'test-password'}
    edit = {'full_name': 'Updated name', 'email': new_email, 'timezone': 'Europe/Moscow', **credentials}
    response = client.patch(path, json=edit, headers=admin)
    assert response.status_code == 200 and response.json()['sessions_revoked']
    assert response.json()['email'] == new_email and not response.json()['email_verified']
    assert client.get('/api/v1/auth/me', headers=regular).status_code == 401
    assert client.post(path + '/delete', json={'confirmation_email': email, **credentials}, headers=admin).status_code == 422
    assert client.post(f'/api/v1/admin/users/{admin_id}/delete',
                       json={'confirmation_email': admin_email, **credentials}, headers=admin).status_code == 400
    assert client.post(path + '/delete', json={'confirmation_email': new_email, **credentials}, headers=admin).json() == {'deleted': True}
    with SessionLocal() as db:
        assert db.get(models.User, uid) is None
        assert db.get(models.Pet, owned['id']) is None
