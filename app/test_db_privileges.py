"""Exercise real PostgreSQL grants; restricted test accounts may skip provisioning."""
import secrets
import sys
from pathlib import Path
import uuid

from alembic import command
import psycopg
from psycopg import sql
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

import models
from database import engine
from db_security import assert_runtime_permissions
from schema import migration_config
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from provision_postgres import provision


@pytest.fixture
def secure_database():
    if engine.dialect.name != 'postgresql': pytest.skip('Requires PostgreSQL')
    url=engine.url
    control=psycopg.connect(host=url.host,port=url.port,dbname=url.database,user=url.username,password=url.password,**dict(url.query))
    if not control.execute('SELECT rolsuper FROM pg_roles WHERE rolname=current_user').fetchone()[0]:
        control.close();pytest.skip('Provisioning test requires a disposable test database administrator')
    suffix=uuid.uuid4().hex[:12];schema='secure_'+suffix
    roles={key: ('pc_'+key+'_'+suffix,secrets.token_urlsafe(24)) for key in ('app','migrator','backup')}
    engines={}
    try:
        provision(control,schema,roles,create_roles=True)
        control.commit()
        for key,(name,password) in roles.items():
            engines[key]=create_engine(url.set(username=name,password=password).update_query_dict({'options':'-csearch_path='+schema}))
        with engines['migrator'].begin() as connection:
            config=migration_config();config.attributes['connection']=connection
            command.upgrade(config,'head')
        provision(control,schema,roles,grants=True);control.commit()
        yield engines,schema,roles
    finally:
        for item in engines.values():item.dispose()
        control.rollback()
        control.execute(sql.SQL('DROP SCHEMA IF EXISTS {} CASCADE').format(sql.Identifier(schema)))
        for name,_ in roles.values():
            if control.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',(name,)).fetchone():
                control.execute(sql.SQL('DROP OWNED BY {}').format(sql.Identifier(name)))
                control.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(name)))
        control.commit();control.close()


def test_runtime_data_only_and_backup_read_only(secure_database):
    engines,schema,roles=secure_database
    app=engines['app'];backup=engines['backup']
    assert_runtime_permissions(app)
    with app.begin() as connection:
        user_id=connection.execute(models.User.__table__.insert().values(full_name='Проверка',email='security@example.com',hashed_password='hash').returning(models.User.id)).scalar_one()
        connection.execute(models.User.__table__.update().where(models.User.id==user_id).values(full_name='Новое имя'))
    with backup.connect() as connection:
        assert connection.scalar(text('SELECT full_name FROM users'))=='Новое имя'
    for statement in ['CREATE TABLE forbidden(id int)','ALTER TABLE users ADD COLUMN forbidden int','DROP TABLE users','UPDATE alembic_version SET version_num=version_num','SET ROLE '+roles['migrator'][0]]:
        with pytest.raises(DBAPIError),app.begin() as connection:connection.execute(text(statement))
    with pytest.raises(DBAPIError),backup.begin() as connection:connection.execute(text('DELETE FROM users'))
    with app.begin() as connection:connection.execute(text('DELETE FROM users'))
    # Default grants also cover the next table created by a migration.
    with engines['migrator'].begin() as connection:connection.execute(text('CREATE TABLE future_data (id SERIAL PRIMARY KEY, value TEXT)'))
    with app.begin() as connection:connection.execute(text("INSERT INTO future_data(value) VALUES ('data')"))
    with backup.connect() as connection:assert connection.scalar(text('SELECT value FROM future_data'))=='data'


def test_production_guard_rejects_admin_role():
    if engine.dialect.name!='postgresql':pytest.skip('Requires PostgreSQL')
    with pytest.raises(RuntimeError):assert_runtime_permissions(engine)
