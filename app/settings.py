import os
from pathlib import Path
from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parent
ENV_FILE = Path(os.environ.get('PETCARE_ENV_FILE', APP_DIR / '.env')).expanduser()
load_dotenv(ENV_FILE)
APP_ENV = os.environ.get('APP_ENV', 'development')
if APP_ENV not in {'development', 'test', 'production'}:
    raise RuntimeError('APP_ENV must be development, test or production')
PRODUCTION = APP_ENV == 'production'
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

if PRODUCTION and (SECRET_KEY.startswith(('GENERATE_', 'ci-only-', 'CHANGE_ME')) or ENV_FILE.exists() and ENV_FILE.stat().st_mode & 0o077):
    raise RuntimeError('Use a private environment file (0600) and a generated production secret')

if PRODUCTION and ENABLE_DEMO_LOGIN:
    raise RuntimeError('Demo login must be disabled in production')


from connection_config import validate_url

def validate_database_url(value, production=PRODUCTION):
    return validate_url(value, production)

DATABASE_URL = validate_database_url(DATABASE_URL)
