"""Explicit schema migrations; DATABASE_URL is read from private environment."""
from alembic import context
from database import Base, engine
import models  # register all model tables


def run_migrations():
    if context.is_offline_mode():
        context.configure(url=engine.url, target_metadata=Base.metadata, literal_binds=True)
        with context.begin_transaction():
            context.run_migrations()
    else:
        def apply(connection):
            context.configure(connection=connection, target_metadata=Base.metadata, compare_type=True)
            with context.begin_transaction():
                context.run_migrations()
        supplied = context.config.attributes.get('connection')
        if supplied is not None:
            apply(supplied)
        else:
            with engine.connect() as connection:
                apply(connection)


run_migrations()
