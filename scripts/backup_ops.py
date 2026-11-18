"""Offsite encrypted backups and restore drills. Schedules are opt-in templates."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
from urllib.parse import urlsplit
import uuid
import ipaddress
import psycopg
from psycopg import sql
from sqlalchemy.engine import make_url

from dotenv import load_dotenv
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backup import dump_database, verify_restore


def validate_repository(repository, local_test=False):
    if local_test and os.getenv('APP_ENV') != 'production': return
    if repository.startswith('s3:https://'):
        host = urlsplit(repository[3:]).hostname
    elif repository.startswith('sftp://'):
        host = urlsplit(repository).hostname
    elif repository.startswith('sftp:'):
        authority = repository[5:].split('@')[-1]
        host = authority[1:].split(']', 1)[0] if authority.startswith('[') else authority.split(':', 1)[0]
    elif repository.startswith('rest:https://'):
        host = urlsplit(repository[5:]).hostname
    else: raise ValueError('Configure an off-server HTTPS/SFTP restic repository')
    host = (host or '').lower().rstrip('.')
    try: local = ipaddress.ip_address(host).is_loopback
    except ValueError: local = host == 'localhost'
    if not host or local:
        raise ValueError('Backup repository must be on a separate server')


def restic(arguments, **kwargs):
    result = subprocess.run(['restic', *arguments], stderr=subprocess.PIPE, **kwargs)
    if result.returncode: raise RuntimeError('restic failed; inspect backup service access and storage')
    return result


def restore_drill(control_url, dump, manifest):
    from app.connection_config import validate_url
    url = make_url(validate_url(control_url, os.getenv('APP_ENV') == 'production'))
    if not (url.database or '').startswith('petcare_restore_'):
        raise ValueError('Restore control database must start with petcare_restore_')
    database = 'petcare_restore_' + uuid.uuid4().hex
    with psycopg.connect(**dict({'host':url.host,'port':url.port,'dbname':url.database,'user':url.username,
                                    'password':url.password,'autocommit':True}, **dict(url.query))) as connection:
        connection.execute(sql.SQL('CREATE DATABASE {} TEMPLATE template0').format(sql.Identifier(database)))
        try:
            verify_restore(url.set(database=database).render_as_string(hide_password=False), dump, manifest)
        finally:
            # Only this freshly generated database is removed, never the configured control DB.
            connection.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(database)))


def run(mode, local_test=False):
    validate_repository(os.environ.get('RESTIC_REPOSITORY', ''), local_test)
    password_file = Path(os.environ['RESTIC_PASSWORD_FILE'])
    if password_file.stat().st_mode & 0o077: raise ValueError('Restic password file must be private (0600)')
    with tempfile.TemporaryDirectory(prefix='petcare-backup-') as directory:
        root = Path(directory)
        dump, manifest, bundle = (root / name for name in ('petcare.dump', 'manifest.json', 'petcare-backup.tar'))
        if mode == 'backup':
            url = os.environ['BACKUP_DATABASE_URL']
            dump_database(url, dump, schema=os.getenv('PG_APP_SCHEMA', 'public'), manifest_path=manifest)
            bundle.touch(mode=0o600)
            with tarfile.open(bundle, 'w') as archive:
                archive.add(dump, arcname=dump.name)
                archive.add(manifest, arcname=manifest.name)
            with bundle.open('rb') as data:
                restic(['backup', '--stdin', '--stdin-filename', 'petcare-backup.tar', '--tag', 'petcare', '--json'], stdin=data, stdout=subprocess.PIPE)
            print('Encrypted offsite backup completed')
        else:
            # Integrity alone is insufficient: restore and compare every row/value.
            restic(['check', '--read-data'], stdout=subprocess.PIPE)
            bundle.touch(mode=0o600)
            with bundle.open('wb') as data:
                restic(['dump', '--tag', 'petcare', 'latest', '/petcare-backup.tar'], stdout=data)
            with tarfile.open(bundle) as archive:
                if set(archive.getnames()) != {'petcare.dump', 'manifest.json'}:
                    raise ValueError('Unexpected backup bundle contents')
                for member in archive.getmembers():
                    if not member.isfile(): raise ValueError('Only regular backup files are allowed')
                    source = archive.extractfile(member)
                    descriptor = os.open(root / member.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                    with source, os.fdopen(descriptor, 'wb') as target:
                        import shutil
                        shutil.copyfileobj(source, target)
            restore_drill(os.environ['RESTORE_TEST_DATABASE_URL'], dump, json.loads(manifest.read_text()))
            print('Restore drill completed: all table counts and values match')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['backup', 'verify'])
    parser.add_argument('--local-test', action='store_true')
    args = parser.parse_args()
    config = os.environ.get('PETCARE_BACKUP_ENV_FILE')
    if config:
        config_path = Path(config)
        if config_path.stat().st_mode & 0o077: raise SystemExit('Backup environment file must be private (0600)')
        load_dotenv(config_path)
    try: run(args.mode, args.local_test)
    except Exception as exc: raise SystemExit('Backup operation failed: ' + type(exc).__name__) from None


if __name__ == '__main__': main()
