"""Regression coverage for the 10 MB upload and independent profile photo."""
import base64
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image
import pytest

import main
from test_security_features import user, pet
from uploads import MAX_FILE_BYTES


def photo_url(color, size=None):
    output = BytesIO()
    Image.new('RGB', (40, 40), color).save(output, format='PNG')
    value = output.getvalue()
    if size:
        value += b'\0' * (size - len(value))
    return 'data:image/png;base64,' + base64.b64encode(value).decode()


@pytest.fixture
def client():
    return TestClient(main.app, client=('198.51.100.249', 51000))


def test_ten_mb_document_and_photo_reach_api(client):
    headers = user()[2]
    animal = pet(client, headers)
    data = photo_url('green', MAX_FILE_BYTES)
    document = client.post(f"/api/v1/pets/{animal['id']}/documents", headers=headers,
                           json={'title':'Большое фото', 'date':'2026-11-17', 'file_name':'large.png', 'file_data':data})
    assert document.status_code == 201, document.text[:200]
    saved = client.put(f"/api/v1/pets/{animal['id']}", headers=headers, json={'photo_file_id':data})
    assert saved.status_code == 200, saved.text[:200]
    oversized = client.post(f"/api/v1/pets/{animal['id']}/documents", headers=headers,
                            json={'title':'Слишком большой', 'date':'2026-11-17', 'file_name':'large.png',
                                  'file_data':photo_url('green', MAX_FILE_BYTES + 1)})
    assert oversized.status_code == 422


@pytest.mark.parametrize('profile_exists', [False, True])
def test_profile_uses_avatar_and_replacement_does_not_change_pet(client, profile_exists):
    headers = user()[2]
    animal = pet(client, headers)
    avatar, replacement = photo_url('green'), photo_url('blue')
    payload = {'name':'Барсик','species':'Кошка','owner_contact':'@demo'}
    url = f"/api/v1/pets/{animal['id']}/match-profile"
    if profile_exists:
        assert client.post(url, headers=headers, json=payload).status_code == 200
    assert client.put(f"/api/v1/pets/{animal['id']}", headers=headers, json={'photo_file_id':avatar}).status_code == 200
    inherited = client.post(url, headers=headers, json=payload)
    assert inherited.status_code == 200
    assert inherited.json()['photo'] == avatar
    updated = client.post(url, headers=headers, json={**payload, 'photo':replacement})
    assert updated.status_code == 200
    assert updated.json()['photo'] == replacement
    animal_after = client.get(f"/api/v1/pets/{animal['id']}", headers=headers).json()
    assert animal_after['photo_file_id'] == avatar
    # Saving text only retains the chosen profile photo.
    assert client.post(url, headers=headers, json=payload).json()['photo'] == replacement
