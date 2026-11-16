from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import declarative_base, sessionmaker

from settings import DATABASE_URL

def create_database_engine(url):
    dialect = make_url(url).get_backend_name()
    if dialect not in {"postgresql", "sqlite"}:
        raise ValueError("Only PostgreSQL and SQLite (migration/tests) are supported")
    options = {"pool_pre_ping": True}
    if dialect == "sqlite":
        options["connect_args"] = {"check_same_thread": False, "timeout": 30}
    else:
        options["connect_args"] = {"connect_timeout": 10}
    return create_engine(url, **options)


engine = create_database_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
