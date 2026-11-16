"""Migrate a fresh schema for each pytest run, never application/user tables."""
import atexit
import os
from pathlib import Path
import tempfile
import uuid

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

_tmp = tempfile.TemporaryDirectory(prefix='petcare-tests-')
url = make_url(os.environ.get('TEST_DATABASE_URL') or 'sqlite:///' + str(Path(_tmp.name) / 'test.db'))
if url.drivername in {'postgres', 'postgresql'}:
    url = url.set(drivername='postgresql+psycopg')
if url.get_backend_name() == 'postgresql':
    namespace = 'test_' + uuid.uuid4().hex
    control = create_engine(url)
    with control.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA {namespace}'))
    url = url.update_query_dict({'options': url.query.get('options', '') + f' -csearch_path={namespace}'})

    def cleanup():
        from database import engine
        engine.dispose()
        with control.begin() as connection:
            connection.execute(text(f'DROP SCHEMA {namespace} CASCADE'))
        control.dispose()

    atexit.register(cleanup)

os.environ['DATABASE_URL'] = url.render_as_string(hide_password=False)
os.environ.setdefault('SECRET_KEY', 'isolated-test-key-not-for-production-at-least-32-characters')
os.environ['ENABLE_DEMO_LOGIN'] = 'true'

from alembic import command
from schema import migration_config
command.upgrade(migration_config(), 'head')
