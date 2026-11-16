"""Real encrypted backup/restore drill, using disposable databases only."""
from pathlib import Path
import os
import secrets
import shutil
import subprocess
import sys
import uuid

import psycopg
from psycopg import sql
import pytest

from database import engine
from test_db_privileges import secure_database
import models
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backup import dump_database, verify_restore
from scripts.backup_ops import run, validate_repository


@pytest.mark.parametrize('repository',[
    '/srv/backups','s3:http://storage.example/bucket','sftp:user@localhost:/repo',
    's3:https://127.0.0.2/bucket','s3:https://localhost./bucket','sftp:user@[::1]:/repo',
    'sftp://user@localhost/repo','sftp://user@[::1]/repo',
])
def test_offsite_repository_rejects_local_or_unencrypted(repository):
    with pytest.raises(ValueError):validate_repository(repository)


def test_backup_validation_does_not_leave_partial_file(tmp_path,monkeypatch):
    monkeypatch.setenv('APP_ENV','production')
    target=tmp_path/'failed.dump'
    with pytest.raises(RuntimeError):dump_database('postgresql://u:p@remote/petcare',target)
    assert not target.exists()


def test_encrypted_backup_and_repeated_restore_drill(secure_database,tmp_path,monkeypatch):
    for binary in ('pg_dump','pg_restore','restic'):
        if not shutil.which(binary):
            if os.getenv('PETCARE_REQUIRE_BACKUP_TESTS')=='true':pytest.fail('Required backup tool missing: '+binary)
            pytest.skip('Backup integration requires '+binary)
    engines,schema,roles=secure_database
    with engines['app'].begin() as connection:
        uid=connection.execute(models.User.__table__.insert().values(full_name='Проверка восстановления',email='backup@example.com',hashed_password='unchanged-hash').returning(models.User.id)).scalar_one()
        pid=connection.execute(models.Pet.__table__.insert().values(owner_id=uid,name='Лапа',species='Кошка').returning(models.Pet.id)).scalar_one()
        connection.execute(models.Document.__table__.insert().values(pet_id=pid,title='Документ',file_data='data:text/plain;base64,aGk='))
    password=tmp_path/'restic-password';password.touch(mode=0o600);password.write_text(secrets.token_urlsafe(32))
    monkeypatch.setenv('APP_ENV','test')
    monkeypatch.setenv('RESTIC_REPOSITORY',str(tmp_path/'encrypted-repository'))
    monkeypatch.setenv('RESTIC_PASSWORD_FILE',str(password))
    monkeypatch.setenv('BACKUP_DATABASE_URL',engines['backup'].url.render_as_string(hide_password=False))
    monkeypatch.setenv('PG_APP_SCHEMA',schema)
    subprocess.run(['restic','init'],check=True,capture_output=True)
    control_name='petcare_restore_control_'+uuid.uuid4().hex[:10]
    url=engine.url
    control=psycopg.connect(host=url.host,port=url.port,dbname=url.database,user=url.username,password=url.password,autocommit=True)
    control.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(control_name)))
    monkeypatch.setenv('RESTORE_TEST_DATABASE_URL',url.set(database=control_name).render_as_string(hide_password=False))
    before={row[0] for row in control.execute("SELECT datname FROM pg_database WHERE datname LIKE 'petcare_restore_%'").fetchall()}
    try:
        run('backup',local_test=True)
        run('verify',local_test=True)
        run('verify',local_test=True)  # A weekly schedule must work more than once.
        assert {row[0] for row in control.execute("SELECT datname FROM pg_database WHERE datname LIKE 'petcare_restore_%'").fetchall()}==before
    finally:
        control.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(control_name)));control.close()


def test_public_schema_restore_into_fresh_database(tmp_path):
    if engine.dialect.name!='postgresql':pytest.skip('Requires PostgreSQL')
    if not shutil.which('pg_dump') or not shutil.which('pg_restore'):pytest.skip('Requires PostgreSQL client tools')
    from alembic import command
    from sqlalchemy import create_engine
    from schema import migration_config
    from scripts.backup_ops import restore_drill
    url=engine.url
    source_name='pc_security_source_'+uuid.uuid4().hex[:10]
    control_name='petcare_restore_control_'+uuid.uuid4().hex[:10]
    control=psycopg.connect(host=url.host,port=url.port,dbname=url.database,user=url.username,password=url.password,autocommit=True)
    for name in (source_name,control_name):control.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    source_url=url.set(database=source_name).difference_update_query(['options'])
    source=create_engine(source_url)
    try:
        with source.begin() as connection:
            config=migration_config();config.attributes['connection']=connection;command.upgrade(config,'head')
        dump=tmp_path/'public.dump';manifest=tmp_path/'manifest.json'
        dump_database(source_url.render_as_string(hide_password=False),dump,schema='public',manifest_path=manifest)
        import json
        restore_drill(url.set(database=control_name).render_as_string(hide_password=False),dump,json.loads(manifest.read_text()))
    finally:
        source.dispose()
        for name in (source_name,control_name):control.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
        control.close()
