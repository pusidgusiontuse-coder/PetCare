"""Check tracked files for accidental private files and common credential formats.

Prints only filenames/categories, never matching secret values. Complements review;
it is not proof that every possible secret is absent.
"""
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    'private key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'GitHub token': re.compile(rb'\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b'),
    'Google API key': re.compile(rb'\b(?:AIza[0-9A-Za-z_-]{35}|AQ\.[A-Za-z0-9_-]{40,})(?![A-Za-z0-9_-])'),
    'AWS access key': re.compile(rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
}


def check():
    paths=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
    findings=[]
    for name in filter(None,paths):
        path=ROOT/name
        if not path.is_file():continue
        private_env = (path.name == '.env' or path.name.startswith('.env.') or path.name.endswith('.env')) and not path.name.endswith('.example')
        private_access = path.name in {
            '.pgpass', 'pg_service.conf', 'bootstrap-admin.json', 'local-access.json',
            'restic-password', 'ДОСТУП_АДМИНИСТРАТОРА.txt',
        } or path.name.startswith('admin-access') and path.suffix == '.json'
        private_suffix = path.suffix in {'.db', '.sqlite', '.sqlite3', '.zip', '.dump', '.backup', '.pem', '.p12', '.pfx'}
        if private_env or private_access or private_suffix:
            findings.append((name,'private file tracked'))
        if path.stat().st_size>2_000_000:continue
        content=path.read_bytes()
        if b'\x00' in content:continue
        for category,pattern in PATTERNS.items():
            if pattern.search(content):findings.append((name,category))
    for name,category in findings:print(f'{name}: {category}')
    return not findings


if __name__=='__main__':
    if not check():raise SystemExit(1)
    print('Tracked-file secret checks passed')
