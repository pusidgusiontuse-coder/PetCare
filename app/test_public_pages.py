from xml.etree import ElementTree

from fastapi.testclient import TestClient

from main import app


def test_public_pages_are_discoverable_without_login_or_javascript(monkeypatch):
    origin = 'https://petcare.example'
    monkeypatch.setenv('PUBLIC_SITE_URL', origin + '/')
    client = TestClient(app)

    home = client.get('/')
    assert home.status_code == 200
    assert f'<link rel="canonical" href="{origin}/">' in home.text
    assert 'href="/about"' in home.text

    about = client.get('/about')
    assert about.status_code == 200
    assert '<h1>Дневник здоровья и ухода за питомцами</h1>' in about.text
    assert f'<link rel="canonical" href="{origin}/about">' in about.text
    assert 'noindex' not in about.headers.get('x-robots-tag', '')
    assert 'content-security-policy' in about.headers

    english = client.get('/about?lang=en')
    assert english.status_code == 200
    assert '<html lang="en">' in english.text
    assert f'rel="canonical" href="{origin}/about?lang=en"' in english.text
    assert f'hreflang="ru" href="{origin}/about"' in english.text
    assert f'hreflang="en" href="{origin}/about?lang=en"' in about.text
    assert client.get('/about?lang=ru').text == about.text

    sitemap = client.get('/sitemap.xml')
    assert sitemap.status_code == 200
    assert [node.text for node in ElementTree.fromstring(sitemap.content).findall('.//{*}loc')] == [
        origin + '/', origin + '/about', origin + '/about?lang=en',
    ]
    assert f'Sitemap: {origin}/sitemap.xml' in client.get('/robots.txt').text
    assert client.get('/api/v1/health').headers['x-robots-tag'] == 'noindex'


def test_unconfigured_site_does_not_advertise_a_guessed_domain(monkeypatch):
    monkeypatch.delenv('PUBLIC_SITE_URL', raising=False)
    client = TestClient(app)
    assert 'rel="canonical"' not in client.get('/about').text
    assert 'Sitemap:' not in client.get('/robots.txt').text
    assert client.get('/sitemap.xml').status_code == 404
