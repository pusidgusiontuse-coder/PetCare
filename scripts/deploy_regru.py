"""Install the packaged PetCare release alongside the active release on REG.RU."""

import argparse
from ast import literal_eval
import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen
from zipfile import ZipFile

BASE = Path.home()
DOMAIN = 'petcarehome.ru'
URL = f'https://{DOMAIN}'
SITE = BASE / 'www' / DOMAIN
DISPATCHER = SITE / 'passenger_wsgi.py'
RESTART = SITE / 'tmp/restart.txt'
RUNTIME = BASE / 'petcare-release-cad695c'
ENV_FILE = RUNTIME / 'app/.env'
BOOTSTRAP_PYTHON = RUNTIME / '.venv/bin/python'
PREVIOUS = BASE / 'petcare-release-premium-20261119'
PREVIOUS_MARKER = 'premium-20261119'
FIRST_LAST1_MARKER = 'last1-reg-ru-20261125'
PERFORMANCE_MARKER = 'last1-performance-20261125'
RELEASE_MARKER = 'last1-one-free-pet-20261125'
DIRECTORIES = {'app', 'docs', 'migrations', 'ops', 'public', 'scripts', 'tests', 'tools', 'wheels'}


def atomic_write(path, data, mode):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        try:
            handle.write(data)
            handle.flush()
            os.fchmod(handle.fileno(), mode)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def live(path, limit=2 * 1024 * 1024):
    separator = '&' if '?' in path else '?'
    request = Request(f'{URL}{path}{separator}pc_release={time.time_ns()}',
                      headers={'Cache-Control': 'no-cache'})
    with urlopen(request, timeout=7) as response:
        body = response.read(limit + 1)
        if len(body) > limit:
            raise RuntimeError(f'Слишком большой ответ при проверке {path}')
        return response.headers.get('X-PetCare-Deployment'), body


def extract(archive_file, release):
    with ZipFile(archive_file) as archive:
        manifest = json.loads(archive.read('MANIFEST.json'))
        for entry, checksum in manifest.items():
            path = PurePosixPath(entry)
            if (not re.fullmatch(r'[a-zA-Z0-9_./-]+', entry) or path.is_absolute()
                    or '..' in path.parts or not path.parts
                    or (len(path.parts) > 1 and path.parts[0] not in DIRECTORIES)):
                raise RuntimeError(f'Недопустимый путь в архиве: {entry}')
            data = archive.read('payload/' + entry)
            if sha256(data).hexdigest() != checksum:
                raise RuntimeError(f'Контрольная сумма не совпадает: {entry}')
            target = release.joinpath(*path.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)


def preserve_public_assets(release, offer, pdf, previous=PREVIOUS):
    legal = release / 'legal'
    legal.mkdir()
    (legal / 'premium.html').write_bytes(offer)
    (legal / 'premium-offer.pdf').write_bytes(pdf)

    static = release / 'app/static'
    for known in (previous, PREVIOUS, RUNTIME):
        for name in ('ocr/vendor', 'petcare.apk'):
            source = known / 'app/static' / name
            target = static / name
            if target.exists():
                continue
            if source.is_dir():
                shutil.copytree(source, target, dirs_exist_ok=True)
            elif source.is_file():
                shutil.copy2(source, target)
    old_assets = previous / 'app/static/frontend/assets'
    for source in sorted(old_assets.glob('*')):
        target = static / 'frontend/assets' / source.name
        if source.is_file() and not target.exists():
            shutil.copy2(source, target)


def install_dependencies(release):
    commands = [
        [str(BOOTSTRAP_PYTHON), '-m', 'venv', str(release / '.venv')],
        [str(release / '.venv/bin/python'), '-m', 'pip', 'install', '--no-index',
         '--disable-pip-version-check', '--find-links', 'wheels', '-r', 'app/requirements.txt'],
    ]
    log = release / 'install.log'
    with log.open('wb') as output:
        for command in commands:
            if subprocess.run(command, cwd=release, stdout=output, stderr=subprocess.STDOUT).returncode:
                raise RuntimeError(f'Не удалось установить зависимости. Журнал: {log}')


def dispatcher_code(release):
    return f"""import os
import sys

interpreter = {str(release / '.venv/bin/python')!r}
if sys.executable != interpreter:
    os.execl(interpreter, interpreter, *sys.argv)
os.environ['PETCARE_ENV_FILE'] = {str(ENV_FILE)!r}
sys.path.insert(0, {str(release / 'app')!r})
from dotenv import load_dotenv
load_dotenv(os.environ['PETCARE_ENV_FILE'])
hosts = [value.strip() for value in os.environ.get('ALLOWED_HOSTS', '').split(',') if value.strip()]
os.environ['ALLOWED_HOSTS'] = ','.join(dict.fromkeys([*hosts, {DOMAIN!r}, {'www.' + DOMAIN!r}]))
os.environ.setdefault('PUBLIC_SITE_URL', {URL!r})
from a2wsgi import ASGIMiddleware
from main import app
serve = ASGIMiddleware(app)

def application(environ, start_response):
    def respond(status, headers, exc_info=None):
        return start_response(status, [*headers, ('X-PetCare-Deployment', {RELEASE_MARKER!r})], exc_info)
    return serve(environ, respond)
""".encode()


def preflight(release, plans, offer, pdf):
    candidate = release / 'candidate_wsgi.py'
    candidate.write_bytes(dispatcher_code(release))
    # The app validates the existing schema and permissions during import.
    check = """
import json
from pathlib import Path
import sys
from fastapi.testclient import TestClient
from candidate_wsgi import app
from database import engine
from settings import PRODUCTION

client = TestClient(app, base_url='https://petcarehome.ru')
def require(condition, name):
    if not condition:
        raise RuntimeError(name)

require(PRODUCTION and engine.dialect.name == 'mysql', 'production environment')
with client:
    require(client.get('/').status_code == 200, 'frontend')
    require(client.get('/api/v1/health').json()['status'] == 'ok', 'health')
    require(client.get('/api/v1/auth/session').status_code == 401, 'unauthenticated session')
    require(client.get('/api/v1/billing/plans').json() == json.loads(sys.argv[1]), 'billing plans')
    require(client.get('/premium').content == Path('legal/premium.html').read_bytes(), 'offer')
    require(client.get('/premium/offer.pdf').content == Path('legal/premium-offer.pdf').read_bytes(), 'offer PDF')
    for route in ('/about', '/robots.txt', '/sitemap.xml'):
        require(client.get(route).status_code == 200, route)
"""
    result = subprocess.run([str(release / '.venv/bin/python'), '-c', check, json.dumps(plans)],
                            cwd=release, capture_output=True, timeout=45)
    if result.returncode:
        assertion = re.search(rb'File "<string>", line (\d+)', result.stderr)
        check_line = f' Проверка на строке {assertion[1].decode()}.' if assertion else ''
        raise RuntimeError(f'Проверка новой версии на текущей БД не прошла.{check_line} Прежний сайт активен.')
    if (release / 'legal/premium.html').read_bytes() != offer or (release / 'legal/premium-offer.pdf').read_bytes() != pdf:
        raise RuntimeError('Оферта изменилась при подготовке')


def verify_active(entry, plans, offer, pdf):
    for _ in range(9):
        try:
            if (live('/api/v1/health')[0] == RELEASE_MARKER
                    and entry in live('/')[1]
                    and live(entry.decode())[0] == RELEASE_MARKER
                    and json.loads(live('/api/v1/billing/plans')[1]) == plans
                    and live('/premium')[1] == offer
                    and live('/premium/offer.pdf')[1] == pdf
                    and live('/sitemap.xml')[0] == RELEASE_MARKER):
                return
        except (OSError, ValueError):
            pass
        time.sleep(2)
    raise RuntimeError('Новая версия не прошла проверку после перезапуска')


def previous_release(marker, dispatcher):
    if marker == PREVIOUS_MARKER:
        return PREVIOUS
    match = re.search(rb'^sys\.path\.insert\(0, (.+)\)$', dispatcher, re.MULTILINE)
    if not match:
        raise RuntimeError('Не найден каталог текущего выпуска last1')
    path = Path(literal_eval(match[1].decode())).resolve()
    if (path.name != 'app' or path.parent.parent != BASE.resolve()
            or not path.parent.name.startswith('petcare-release-last1-') or not path.is_dir()):
        raise RuntimeError('Каталог текущего выпуска last1 отличается от ожидаемого')
    return path.parent


def deploy(check_only):
    if not (DISPATCHER.is_file() and RESTART.parent.is_dir() and ENV_FILE.is_file() and BOOTSTRAP_PYTHON.is_file()):
        raise RuntimeError('Этот пакет рассчитан на существующий сайт petcarehome.ru в REG.RU')
    active, health = live('/api/v1/health')
    if active == RELEASE_MARKER and not check_only:
        print('Эта версия уже работает на сайте.')
        return
    if active not in {PREVIOUS_MARKER, FIRST_LAST1_MARKER, PERFORMANCE_MARKER} or json.loads(health).get('status') != 'ok':
        raise RuntimeError('Рабочая версия отличается от ожидаемой. Нужна сверка перед обновлением.')
    plans = json.loads(live('/api/v1/billing/plans')[1])
    offer = live('/premium')[1]
    pdf = live('/premium/offer.pdf')[1]
    if not offer or not pdf.startswith(b'%PDF-'):
        raise RuntimeError('Не удалось сохранить опубликованную оферту')
    original = DISPATCHER.read_bytes()
    previous = previous_release(active, original)
    mode = stat.S_IMODE(DISPATCHER.stat().st_mode)
    release = Path(tempfile.mkdtemp(prefix='petcare-release-last1-', dir=BASE))
    print(f'Подготовка в {release.name}', flush=True)
    extract(sys.argv[0], release)
    preserve_public_assets(release, offer, pdf, previous)
    install_dependencies(release)
    preflight(release, plans, offer, pdf)

    index = (release / 'app/static/frontend/index.html').read_bytes()
    entry = re.search(rb'src="(/static/frontend/assets/index-[^"]+\.js)"', index)
    if not entry:
        raise RuntimeError('Архив не содержит входного файла интерфейса')
    if check_only:
        print('Проверка пройдена. Сайт продолжает обслуживать прежняя версия.')
        return
    if DISPATCHER.read_bytes() != original:
        raise RuntimeError('Конфигурация сайта изменилась во время подготовки')
    backup = release / 'previous_passenger_wsgi.py'
    atomic_write(backup, original, 0o600)
    atomic_write(DISPATCHER, dispatcher_code(release), mode)
    try:
        RESTART.touch()
        verify_active(entry[1], plans, offer, pdf)
    except BaseException:
        atomic_write(DISPATCHER, original, mode)
        RESTART.touch()
        raise RuntimeError('Вернул прежний диспетчер и запросил перезапуск. Сверьте сайт.') from None
    print(f'PetCare last1 работает на https://{DOMAIN}. Резервная копия: {backup}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true', help='Prepare and verify without activation.')
    mode.add_argument('--apply', action='store_true', help='Prepare, verify and activate the release.')
    args = parser.parse_args()
    try:
        with (BASE / '.petcare-deploy.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            deploy(check_only=args.check)
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        if isinstance(error, RuntimeError):
            print(error, file=sys.stderr)
        else:
            print(f'Обновление прервано: {type(error).__name__}', file=sys.stderr)
        sys.exit(1)
