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
DATABASE_URL = os.environ.get("DATABASE_URL") or "sqlite:///" + str(DATA_DIR / "petcare.db")
ENABLE_DEMO_LOGIN = os.environ.get("ENABLE_DEMO_LOGIN", "false").lower() == "true"
