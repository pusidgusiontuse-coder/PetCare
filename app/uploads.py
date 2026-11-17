"""Bounded attachment validation. Never trust a browser MIME type or filename."""
import base64
import binascii
from io import BytesIO
import re
import warnings

from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError
from pypdf import PdfReader
from pypdf.generic import DictionaryObject, ArrayObject, IndirectObject

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_PHOTO_BYTES = MAX_FILE_BYTES
EXTENSIONS = {
    'image/jpeg': ('.jpg', '.jpeg'), 'image/png': ('.png',),
    'image/webp': ('.webp',), 'application/pdf': ('.pdf',), 'text/plain': ('.txt',),
}
FORBIDDEN_PDF_KEYS = {'/JS', '/JavaScript', '/AA', '/OpenAction', '/EmbeddedFiles', '/EF', '/Launch', '/RichMedia', '/XFA'}


class UnsafeUpload(ValueError):
    pass


def validate_bytes(data, mime, limit=MAX_FILE_BYTES):
    if not data:
        raise UnsafeUpload('Файл пуст')
    if len(data) > limit:
        raise UnsafeUpload('Превышен допустимый размер файла')
    if mime not in EXTENSIONS:
        raise UnsafeUpload('Поддерживаются PDF, TXT, JPG, PNG и WebP')
    if mime.startswith('image/'):
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                with Image.open(BytesIO(data)) as image:
                    expected = {'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WEBP'}[mime]
                    if image.format != expected or image.width * image.height > 40_000_000:
                        raise UnsafeUpload('Неверный формат или слишком большое разрешение изображения')
                    image.verify()
        except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
            raise UnsafeUpload('Изображение повреждено или не соответствует формату') from exc
    elif mime == 'application/pdf':
        try:
            if not data.startswith(b'%PDF-'):
                raise UnsafeUpload('Неверный формат PDF')
            reader = PdfReader(BytesIO(data), strict=True)
            if reader.is_encrypted or not 1 <= len(reader.pages) <= 200:
                raise UnsafeUpload('Нужен PDF без шифрования, от 1 до 200 страниц')
            seen = set()
            def visit(value, depth=0):
                if depth > 50 or len(seen) > 20_000:
                    raise UnsafeUpload('Слишком сложная структура PDF')
                if isinstance(value, IndirectObject):
                    key = (value.idnum, value.generation)
                    if key in seen: return
                    seen.add(key)
                    return visit(value.get_object(), depth + 1)
                if isinstance(value, DictionaryObject):
                    if FORBIDDEN_PDF_KEYS.intersection(value) or str(value.get('/S')) in {'/JavaScript', '/Launch', '/GoToR', '/SubmitForm', '/ImportData'}:
                        raise UnsafeUpload('PDF содержит активное содержимое или вложенные файлы')
                    for child in value.values(): visit(child, depth + 1)
                elif isinstance(value, ArrayObject):
                    for child in value: visit(child, depth + 1)
            visit(reader.trailer)
        except UnsafeUpload:
            raise
        except Exception as exc:
            raise UnsafeUpload('PDF повреждён или не поддерживается') from exc
    else:
        try: text = data.decode('utf-8')
        except UnicodeDecodeError as exc: raise UnsafeUpload('TXT должен быть в UTF-8') from exc
        if '\x00' in text: raise UnsafeUpload('Неверный текстовый файл')


def validate_attachment(value, filename=None, *, images_only=False, limit=MAX_FILE_BYTES):
    if not value: return value, filename
    if not isinstance(value, str) or len(value) > (limit + 2) // 3 * 4 + 128:
        raise UnsafeUpload('Превышен допустимый размер файла')
    match = re.fullmatch(r'data:([a-z]+/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]*)', value)
    if not match: raise UnsafeUpload('Файл должен быть передан как base64 data URL')
    mime = match[1]
    if images_only and mime not in {'image/jpeg', 'image/png', 'image/webp'}:
        raise UnsafeUpload('Для фотографии поддерживаются JPG, PNG и WebP')
    try: data = base64.b64decode(match[2].replace('\r', '').replace('\n', ''), validate=True)
    except (ValueError, binascii.Error) as exc: raise UnsafeUpload('Некорректный base64') from exc
    validate_bytes(data, mime, limit)
    name = (filename or ('attachment' + EXTENSIONS[mime][0])).replace('\\', '/').rsplit('/', 1)[-1]
    name = ''.join(char for char in name if char.isprintable() and char not in ':\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069').strip(' .')
    if not name or len(name) > 180 or not name.lower().endswith(EXTENSIONS[mime]):
        raise UnsafeUpload('Название или расширение файла не соответствует формату')
    return 'data:' + mime + ';base64,' + base64.b64encode(data).decode('ascii'), name


def checked_upload(data, mime):
    if mime not in {'image/jpeg', 'image/png', 'image/webp'}:
        raise HTTPException(415, 'Поддерживаются JPG, PNG и WebP')
    try: validate_bytes(data, mime)
    except ValueError as exc:
        code = 413 if len(data) > MAX_FILE_BYTES else 415
        raise HTTPException(code, str(exc)) from None


def safe_stored_url(value, *, image=False):
    """Hide unsafe legacy link schemes in responses without deleting stored data."""
    if not value: return value
    if not isinstance(value, str) or len(value) > (MAX_FILE_BYTES + 2) // 3 * 4 + 128: return None
    match = re.fullmatch(r'data:([a-z]+/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]*)', value)
    allowed = {'image/jpeg', 'image/png', 'image/webp'} if image else EXTENSIONS
    if not match or match[1] not in allowed: return None
    try: base64.b64decode(match[2].replace('\r', '').replace('\n', ''), validate=True)
    except (ValueError, binascii.Error): return None
    return value
