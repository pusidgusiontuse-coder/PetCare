from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from model_base import Base

from settings import DATABASE_URL, validate_database_url

def create_database_engine(url):
    url = validate_database_url(url)
    dialect = make_url(url).get_backend_name()
    if dialect not in {"postgresql", "sqlite"}:
        raise ValueError("Only PostgreSQL and SQLite (migration/tests) are supported")
    options = {"pool_pre_ping": True}
    if dialect == "sqlite":
        options["connect_args"] = {"check_same_thread": False, "timeout": 30}
    else:
        options["connect_args"] = {"connect_timeout": 10}
    return create_engine(url, hide_parameters=True, **options)


engine = create_database_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
