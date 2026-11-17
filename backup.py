"""Consistent private PostgreSQL dump and manifest; no app or migration secrets needed."""
from contextlib import contextmanager
import configparser
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from dotenv import load_dotenv
from sqlalchemy import MetaData, create_engine, select
from sqlalchemy.engine import make_url
sys.path.insert(0, str(Path(__file__).resolve().parent / 'app'))
from connection_config import validate_url


@contextmanager
def pg_environment(url):
    parsed = make_url(validate_url(url, os.getenv('APP_ENV') == 'production'))
    if parsed.get_backend_name() != 'postgresql': raise ValueError('PostgreSQL is required')
    with tempfile.TemporaryDirectory(prefix='petcare-pg-') as directory:
        service = Path(directory) / 'pg_service.conf'
        config = configparser.ConfigParser(interpolation=None)
        config['petcare_job'] = {key: str(value) for key, value in {
            'host': parsed.host, 'port': parsed.port, 'dbname': parsed.database,
            'user': parsed.username, 'password': parsed.password, **dict(parsed.query),
        }.items() if value is not None}
        service.touch(mode=0o600)
        with service.open('w') as file: config.write(file, space_around_delimiters=False)
        # Clear inherited libpq connection overrides; use only this service.
        env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
        env.update(PGSERVICEFILE=str(service), PGSERVICE='petcare_job')
        yield env


def database_manifest(connection, schema):
    metadata = MetaData(schema=schema)
    metadata.reflect(bind=connection)
    result = {}
    for table in metadata.sorted_tables:
        if not len(table.primary_key): raise ValueError('Manifest requires primary keys')
        digest, count = hashlib.sha256(), 0
        for row in connection.execute(select(table).order_by(*table.primary_key.columns).execution_options(yield_per=250)):
            digest.update((json.dumps(list(row), default=str, ensure_ascii=False, allow_nan=False) + '\n').encode())
            count += 1
        result[table.name] = {'rows': count, 'sha256': digest.hexdigest()}
    if 'users' not in result or 'pets' not in result or 'alembic_version' not in result:
        raise ValueError('Source does not contain a migrated PetCare database')
    return result


def dump_database(url, target, *, schema='public', manifest_path=None):
    if make_url(url).get_backend_name() == 'mysql':
        from mysql_backup import dump_mysql
        return dump_mysql(url, target, manifest_path)
    target = Path(target)
    engine = create_engine(validate_url(url, os.getenv('APP_ENV') == 'production'), hide_parameters=True)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'wb') as output, pg_environment(url) as env:
            with engine.connect().execution_options(isolation_level='REPEATABLE READ') as connection:
                connection.exec_driver_sql('SET TRANSACTION READ ONLY')
                snapshot = connection.exec_driver_sql('SELECT pg_export_snapshot()').scalar_one()
                tables = database_manifest(connection, schema)
                result = subprocess.run(['pg_dump', '--format=custom', '--no-owner', '--no-acl',
                                         '--schema='+schema, '--snapshot='+snapshot],
                                        stdout=output, stderr=subprocess.PIPE, env=env)
                if result.returncode: raise RuntimeError('pg_dump failed; check access and client version')
        if manifest_path:
            parsed = make_url(url)
            manifest = {'schema': schema, 'tables': tables,
                        'source': {'host': parsed.host, 'port': parsed.port, 'database': parsed.database},
                        'created_at': datetime.now(timezone.utc).isoformat(),
                        'dump_sha256': file_digest(target)}
            descriptor = os.open(manifest_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'w') as file: json.dump(manifest, file, indent=2)
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    finally:
        engine.dispose()


def file_digest(path):
    with Path(path).open('rb') as file: return hashlib.file_digest(file, 'sha256').hexdigest()


def verify_restore(url, dump, manifest):
    if make_url(url).get_backend_name() == 'mysql':
        from mysql_backup import restore_mysql
        return restore_mysql(url, dump, manifest)
    parsed = make_url(url)
    if not (parsed.database or '').startswith('petcare_restore_'):
        raise ValueError('Restore target database name must start with petcare_restore_')
    source = manifest['source']
    if (parsed.host, parsed.port, parsed.database) == (source['host'], source['port'], source['database']):
        raise ValueError('Restore target must not be the source database')
    if file_digest(dump) != manifest['dump_sha256']: raise ValueError('Dump checksum mismatch')
    engine = create_engine(validate_url(url, os.getenv('APP_ENV') == 'production'), hide_parameters=True)
    try:
        with engine.connect() as connection:
            existing = connection.exec_driver_sql("SELECT 1 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') LIMIT 1").first()
            if existing: raise ValueError('Restore target must be empty; no existing data will be overwritten')
            if manifest['schema'] == 'public':
                # A freshly created database has an empty public schema; the dump recreates it.
                connection.exec_driver_sql('DROP SCHEMA IF EXISTS public')
                connection.commit()
        with pg_environment(url) as env:
            result = subprocess.run(['pg_restore', '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl',
                                     '--dbname=service=petcare_job', str(dump)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if result.returncode: raise RuntimeError('pg_restore failed')
        with engine.connect() as connection:
            if database_manifest(connection, manifest['schema']) != manifest['tables']:
                raise RuntimeError('Restored rows or values do not match the source snapshot')
    finally:
        engine.dispose()


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', type=Path)
    args = parser.parse_args()
    load_dotenv(os.environ.get('PETCARE_ENV_FILE', Path(__file__).resolve().parent / 'app/.env'))
    url = os.environ.get('BACKUP_DATABASE_URL') or os.environ.get('DATABASE_URL')
    if not url or os.getenv('APP_ENV') == 'production' and not os.environ.get('BACKUP_DATABASE_URL'):
        raise SystemExit('BACKUP_DATABASE_URL is required; use a separate read-only backup role')
    try: dump_database(url, args.target, schema=os.getenv('PG_APP_SCHEMA', 'public'))
    except Exception as exc: raise SystemExit('Backup failed: ' + type(exc).__name__) from None
    print('Private database backup saved')


if __name__ == '__main__': main()
