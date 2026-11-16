"""Check schema version without modifying the database during application import."""
from pathlib import Path
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory


def migration_config():
    return Config(str(Path(__file__).resolve().parents[1] / 'alembic.ini'))


def check_schema(engine):
    expected = set(ScriptDirectory.from_config(migration_config()).get_heads())
    with engine.connect() as connection:
        current = set(MigrationContext.configure(connection).get_current_heads())
    if current != expected:
        raise RuntimeError('Database schema is not current. Run: python -m alembic upgrade head')
