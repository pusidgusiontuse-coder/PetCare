import sqlite3
import sys
from pathlib import Path

source = Path(__file__).resolve().parent / 'data' / 'petcare.db'
if len(sys.argv) != 2:
    raise SystemExit('Usage: python backup.py /private/path/backup.db')
target = Path(sys.argv[1]).expanduser().resolve()
if not source.exists():
    raise SystemExit('Database does not exist yet')
if target.exists() or target == source:
    raise SystemExit('Destination already exists; choose a new filename')
# Backups remain private even with a permissive account umask.
import os
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
os.close(fd)
with sqlite3.connect(source) as src, sqlite3.connect(target) as dst:
    src.backup(dst)
print('Backup saved:', target)
