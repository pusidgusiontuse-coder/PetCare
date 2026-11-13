import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INTERP = str(ROOT / ".venv" / "bin" / "python")
if sys.executable != INTERP:
    os.execl(INTERP, INTERP, *sys.argv)
sys.path.insert(0, str(ROOT / "app"))
from a2wsgi import ASGIMiddleware
from main import app
application = ASGIMiddleware(app)
