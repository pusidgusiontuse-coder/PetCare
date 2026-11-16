"""Run with Python 3.12 on the hosting server, outside the website directory."""
import argparse
import os
from pathlib import Path
import secrets
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description='Prepare PetCare for REG.RU ispmanager')
parser.add_argument('--upgrade', action='store_true', help='Update an existing PetCare dispatcher after backup')
parser.add_argument('--public-dir', type=Path, help='Existing website document root; omit to use ./public')
args = parser.parse_args()
if not (3, 10) <= sys.version_info[:2] <= (3, 12):
    raise SystemExit('Use Python 3.10–3.12 (recommended: 3.12).')
if not (ROOT / 'app' / 'static' / 'frontend' / 'index.html').is_file():
    raise SystemExit('Frontend build missing. Run npm ci && npm run build locally and upload app/static/frontend/ before setup.')
public = (args.public_dir or ROOT / 'public').expanduser().resolve()
# Never put private files under the web root.
if ROOT == public or public in ROOT.parents:
    raise SystemExit('PetCare must be OUTSIDE the public website directory.')
if (public / 'index.html').exists() or (public / 'index.php').exists():
    raise SystemExit('An index file already exists in the website directory. Back up the old site and move its index file before continuing.')
public.mkdir(parents=True, exist_ok=True)
dispatcher = public / 'passenger_wsgi.py'
if dispatcher.exists() and public != ROOT / 'public' and not args.upgrade:
    raise SystemExit('passenger_wsgi.py already exists. Back it up and move it before continuing.')
venv.EnvBuilder(with_pip=True).create(ROOT / '.venv')
python = ROOT / '.venv' / 'bin' / 'python'
subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(ROOT / 'app' / 'requirements.txt')], check=True)
private_env = Path(os.environ.get('PETCARE_ENV_FILE', ROOT / 'app' / '.env')).expanduser().resolve()
if private_env == public or public in private_env.parents:
    raise SystemExit('Private environment must be OUTSIDE the public website directory.')
if not private_env.exists():
    fd = os.open(private_env, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write('APP_ENV=production\nALLOWED_HOSTS=\nDATABASE_URL=\nSECRET_KEY=' + secrets.token_urlsafe(48) + '\nENABLE_DEMO_LOGIN=false\nLLM_API_KEY=\n')
(ROOT / 'data').mkdir(mode=0o700, exist_ok=True)
# Schema/data migration and PostgreSQL backup are explicit deployment steps.
# Never create an empty SQLite replacement for an existing installation.
subprocess.run([str(python), '-c', 'from settings import DATABASE_URL; from sqlalchemy.engine import make_url; assert make_url(DATABASE_URL).get_backend_name() == "postgresql", "Configure PostgreSQL first; see docs/POSTGRESQL.md"'], cwd=ROOT / 'app', check=True)
# Keep the VAPID identity stable across updates.
if 'VAPID_PRIVATE_KEY=' not in private_env.read_text():
    result=subprocess.run([str(python),'-c', 'from cryptography.hazmat.primitives.asymmetric import ec; from cryptography.hazmat.primitives import serialization; import base64,json; k=ec.generate_private_key(ec.SECP256R1()); enc=lambda x:base64.urlsafe_b64encode(x).rstrip(b"=").decode(); print(json.dumps([enc(k.private_numbers().private_value.to_bytes(32,"big")),enc(k.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint))]))'],capture_output=True,text=True,check=True)
    import json
    secret,pub=json.loads(result.stdout)
    with private_env.open('a') as f: f.write('VAPID_PRIVATE_KEY='+secret+'\nVAPID_PUBLIC_KEY='+pub+'\n')

migration_env = dict(os.environ)
if os.getenv('PETCARE_MIGRATION_ENV_FILE'):
    migration_env['PETCARE_ENV_FILE'] = os.environ['PETCARE_MIGRATION_ENV_FILE']
subprocess.run([str(python), '-m', 'alembic', 'upgrade', 'head'], cwd=ROOT, env=migration_env, check=True)
subprocess.run([str(python), '-c', 'import main; print("PetCare imports successfully")'], cwd=ROOT / 'app', check=True)
code = f'''import os
import sys
INTERP = {str(python)!r}
if sys.executable != INTERP:
    os.execl(INTERP, INTERP, *sys.argv)
os.environ.setdefault('PETCARE_ENV_FILE', {str(private_env)!r})
sys.path.insert(0, {str(ROOT / 'app')!r})
from a2wsgi import ASGIMiddleware
from main import app
application = ASGIMiddleware(app)
'''
dispatcher.write_text(code)
# Only the dispatcher goes in the existing website directory; no source or data.
(public / '.restart-app').touch()
print('Prepared. Public website directory:', public)
print('Enable Python in ispmanager. Check HTTPS and /api/v1/health in a browser.')
