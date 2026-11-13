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
private_env = ROOT / 'app' / '.env'
if not private_env.exists():
    fd = os.open(private_env, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write('SECRET_KEY=' + secrets.token_urlsafe(48) + '\nENABLE_DEMO_LOGIN=false\nLLM_API_KEY=\n')
(ROOT / 'data').mkdir(mode=0o700, exist_ok=True)
# Back up existing data before schema migration.
if (ROOT / 'data' / 'petcare.db').exists():
    import sqlite3
    from datetime import datetime
    backup=ROOT / 'data' / ('before-update-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'.db')
    with sqlite3.connect(ROOT/'data'/'petcare.db') as source, sqlite3.connect(backup) as dest:
        source.backup(dest)
    backup.chmod(0o600)
# Keep the VAPID identity stable across updates.
if 'VAPID_PRIVATE_KEY=' not in private_env.read_text():
    result=subprocess.run([str(python),'-c', 'from cryptography.hazmat.primitives.asymmetric import ec; from cryptography.hazmat.primitives import serialization; import base64,json; k=ec.generate_private_key(ec.SECP256R1()); enc=lambda x:base64.urlsafe_b64encode(x).rstrip(b"=").decode(); print(json.dumps([enc(k.private_numbers().private_value.to_bytes(32,"big")),enc(k.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint))]))'],capture_output=True,text=True,check=True)
    import json
    secret,pub=json.loads(result.stdout)
    with private_env.open('a') as f: f.write('VAPID_PRIVATE_KEY='+secret+'\nVAPID_PUBLIC_KEY='+pub+'\n')

subprocess.run([str(python), '-c', 'import main; print("PetCare imports successfully")'], cwd=ROOT / 'app', check=True)
code = f'''import os
import sys
INTERP = {str(python)!r}
if sys.executable != INTERP:
    os.execl(INTERP, INTERP, *sys.argv)
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
