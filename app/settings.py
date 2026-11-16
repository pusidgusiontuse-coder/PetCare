import os
from pathlib import Path
from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parent
load_dotenv(APP_DIR / ".env")
DATA_DIR = APP_DIR.parent / "data"
DATA_DIR.mkdir(mode=0o700, exist_ok=True)
SECRET_KEY = os.environ.get("SECRET_KEY", "")
if len(SECRET_KEY) < 32:
    raise RuntimeError("SECRET_KEY must be configured and contain at least 32 characters")
DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL must point to PostgreSQL; see docs/POSTGRESQL.md")
# Hosting providers commonly supply these aliases. Use psycopg 3 explicitly.
if DATABASE_URL.startswith(("postgres://", "postgresql://")):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL.split("://", 1)[1]
ENABLE_DEMO_LOGIN = os.environ.get("ENABLE_DEMO_LOGIN", "false").lower() == "true"
