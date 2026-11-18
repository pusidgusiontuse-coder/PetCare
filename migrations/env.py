"""Schema tooling uses its own credentials; web authentication secrets are not needed."""
import os
from pathlib import Path
from alembic import context
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from connection_config import validate_url
from model_base import Base
import models  # register tables without importing the web engine or settings

load_dotenv(os.environ.get('PETCARE_ENV_FILE', Path(__file__).resolve().parents[1] / 'app/.env'))


def run_migrations():
    supplied = context.config.attributes.get('connection')
    production = os.getenv('APP_ENV') == 'production'
    url = os.environ.get('MIGRATION_DATABASE_URL')
    if production and supplied is None and not url:
        raise RuntimeError('MIGRATION_DATABASE_URL is required for production migrations')
    url = url or os.environ.get('DATABASE_URL')
    if supplied is None and not url: raise RuntimeError('Configure MIGRATION_DATABASE_URL')
    if context.is_offline_mode():
        context.configure(url=make_url(validate_url(url, production)), target_metadata=Base.metadata, literal_binds=True)
        with context.begin_transaction(): context.run_migrations()
        return
    def apply(connection):
        context.configure(connection=connection, target_metadata=Base.metadata, compare_type=True)
        with context.begin_transaction(): context.run_migrations()
    if supplied is not None:
        apply(supplied)
    else:
        engine = create_engine(validate_url(url, production), pool_pre_ping=True, hide_parameters=True)
        try:
            with engine.connect() as connection: apply(connection)
        finally: engine.dispose()


run_migrations()
