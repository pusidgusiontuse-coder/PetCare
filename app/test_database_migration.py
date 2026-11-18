"""Integration checks against disposable PostgreSQL schemas, never live data."""
from datetime import date, datetime
import uuid

from alembic import command
from sqlalchemy import Boolean, Date, DateTime, Float, Integer, create_engine, event, func, select, text
import pytest

import models
from database import engine
from schema import check_schema, migration_config
from transfer_sqlite import TransferError, transfer


@pytest.fixture
def target():
    if engine.dialect.name != 'postgresql':
        pytest.skip('Set TEST_DATABASE_URL to an isolated PostgreSQL database')
    name = 'transfer_' + uuid.uuid4().hex
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA {name}'))
    destination = create_engine(engine.url)

    @event.listens_for(destination, 'connect')
    def search_path(connection, record):
        connection.autocommit = True
        with connection.cursor() as cursor:
            cursor.execute(f'SET search_path TO {name}')
        connection.autocommit = False

    with destination.begin() as connection:
        config = migration_config()
        config.attributes['connection'] = connection
        command.upgrade(config, 'head')
    yield destination
    destination.dispose()
    with engine.begin() as connection:
        connection.execute(text(f'DROP SCHEMA {name} CASCADE'))


@pytest.fixture
def source(tmp_path):
    path = tmp_path / 'source.db'
    sqlite = create_engine('sqlite:///' + str(path))
    models.Base.metadata.create_all(sqlite)
    # Populate every table and column: foreign keys, files, sessions, booleans,
    # dates, password hashes, preferences, hidden PetMatch records and Unicode.
    with sqlite.begin() as connection:
        for table in models.Base.metadata.sorted_tables:
            row = {}
            for column in table.columns:
                if isinstance(column.type, Boolean):
                    value = True
                elif isinstance(column.type, Integer):
                    value = 41
                elif isinstance(column.type, Float):
                    value = 1.25
                elif isinstance(column.type, DateTime):
                    value = datetime(2026, 11, 16, 10, 12, 13, 123456)
                elif isinstance(column.type, Date):
                    value = date(2024, 2, 29)
                else:
                    value = 'Лапа🐾' if column.name != 'hashed_password' else '$2b$12$unchanged-password-hash'
                row[column.name] = value
            connection.execute(table.insert().values(**row))
    sqlite.dispose()
    return path


def test_full_transfer_and_new_ids(source, target):
    before = source.read_bytes()
    report = transfer(source, target)
    assert source.read_bytes() == before
    assert set(report) == set(models.Base.metadata.tables)
    assert all(item['rows'] == 1 for item in report.values())
    with target.begin() as connection:
        user_id = connection.scalar(models.User.__table__.insert().values(
            full_name='Новый', email='new@example.com', hashed_password='hash').returning(models.User.id))
        assert user_id == 42
        assert connection.scalar(select(models.Pet.name)) == 'Лапа🐾'
        assert connection.scalar(select(models.User.hashed_password).where(models.User.id == 41)) == '$2b$12$unchanged-password-hash'
        assert connection.scalar(select(models.Pet.birth_date)) == date(2024, 2, 29)
        assert connection.scalar(select(models.Pet.sterilized)) is True


def test_refuses_nonempty_target(source, target):
    transfer(source, target)
    with pytest.raises(TransferError, match='not empty'):
        transfer(source, target)
    with target.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(models.User)) == 1


def test_constraint_error_rolls_back_all_tables(source, target):
    sqlite = create_engine('sqlite:///' + str(source))
    with sqlite.begin() as connection:
        # SQLite accepts oversized VARCHAR; PostgreSQL must reject, never truncate.
        connection.execute(models.Pet.__table__.update().values(name='x' * 101))
    sqlite.dispose()
    with pytest.raises(Exception):
        transfer(source, target)
    with target.connect() as connection:
        for table in models.Base.metadata.sorted_tables:
            assert connection.scalar(select(func.count()).select_from(table)) == 0


def test_broken_foreign_keys_rejected(source, target):
    sqlite = create_engine('sqlite:///' + str(source))
    with sqlite.begin() as connection:
        connection.execute(models.Pet.__table__.update().values(owner_id=9999))
    sqlite.dispose()
    with pytest.raises(TransferError, match='foreign keys'):
        transfer(source, target)


def test_unrecognized_schema_rejected(source, target):
    sqlite = create_engine('sqlite:///' + str(source))
    with sqlite.begin() as connection:
        connection.execute(text('CREATE TABLE unknown_records (id INTEGER)'))
    sqlite.dispose()
    with pytest.raises(TransferError, match='Unknown source tables'):
        transfer(source, target)


def test_upgrade_downgrade_and_drift(target):
    check_schema(target)
    with target.begin() as connection:
        config = migration_config()
        config.attributes['connection'] = connection
        command.check(config)
        command.downgrade(config, 'base')
    with pytest.raises(RuntimeError, match='not current'):
        check_schema(target)
    with target.begin() as connection:
        config = migration_config()
        config.attributes['connection'] = connection
        command.upgrade(config, 'head')
    check_schema(target)


def test_incomplete_source_rejected(tmp_path, target):
    import sqlite3
    path = tmp_path / 'empty.db'
    with sqlite3.connect(path) as connection:
        connection.execute('CREATE TABLE alembic_version (version_num TEXT)')
    with pytest.raises(TransferError, match='Missing source tables'):
        transfer(path, target)


def test_invalid_boolean_rejected(source, target):
    sqlite = create_engine('sqlite:///' + str(source))
    with sqlite.begin() as connection:
        connection.execute(text('UPDATE users SET disabled=2'))
    sqlite.dispose()
    with pytest.raises(TransferError, match='Invalid boolean'):
        transfer(source, target)
