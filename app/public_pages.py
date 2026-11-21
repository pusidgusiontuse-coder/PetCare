"""Public pages and search metadata for the configured website origin."""
from html import escape
import os
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit
from xml.etree import ElementTree

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse, Response

router = APIRouter(include_in_schema=False)
APP_DIR = Path(__file__).resolve().parent
ABOUT_PATHS = {'ru': '/about', 'en': '/about?lang=en'}
PUBLIC_PATHS = ('/', *ABOUT_PATHS.values())


def public_origin():
    value = os.getenv('PUBLIC_SITE_URL', '').strip()
    if not value:
        return None
    url = urlsplit(value)
    if (
        url.scheme != 'https' or not url.hostname or url.username or url.password
        or url.path not in ('', '/') or url.query or url.fragment
        or any(char.isspace() or char in '<>"\\' for char in url.netloc)
    ):
        raise ValueError('PUBLIC_SITE_URL must be a public HTTPS origin without a path')
    return f'https://{url.netloc}'


def page_response(source, path):
    origin = public_origin()
    canonical = ''
    if origin:
        location = escape(f'{origin}{path}', quote=True)
        canonical = (
            f'<link rel="canonical" href="{location}">\n'
            f'  <meta property="og:url" content="{location}">'
        )
        if path in ABOUT_PATHS.values():
            canonical += ''.join(
                f'\n  <link rel="alternate" hreflang="{lang}" href="{escape(origin + url, quote=True)}">'
                for lang, url in ABOUT_PATHS.items()
            )
    html = source.read_text(encoding='utf-8').replace('<!-- PETCARE_CANONICAL -->', canonical)
    return HTMLResponse(html)


@router.get('/')
def serve_frontend():
    index = APP_DIR / 'static' / 'frontend' / 'index.html'
    if not index.is_file():
        raise HTTPException(503, 'Frontend build missing. Run npm ci && npm run build before starting PetCare.')
    return page_response(index, '/')


@router.get('/about')
def about(lang: Literal['ru', 'en'] = 'ru'):
    template = 'about.en.html' if lang == 'en' else 'about.html'
    return page_response(APP_DIR / 'pages' / template, ABOUT_PATHS[lang])


@router.get('/robots.txt')
def robots():
    origin = public_origin()
    rules = 'User-agent: *\nAllow: /\n'
    if origin:
        rules += f'Sitemap: {origin}/sitemap.xml\n'
    return PlainTextResponse(rules)


@router.get('/sitemap.xml')
def sitemap():
    origin = public_origin()
    if not origin:
        raise HTTPException(404, 'Set PUBLIC_SITE_URL to publish the sitemap')
    document = ElementTree.Element('urlset', xmlns='http://www.sitemaps.org/schemas/sitemap/0.9')
    for path in PUBLIC_PATHS:
        entry = ElementTree.SubElement(document, 'url')
        ElementTree.SubElement(entry, 'loc').text = f'{origin}{path}'
    return Response(ElementTree.tostring(document, encoding='utf-8', xml_declaration=True), media_type='application/xml')
