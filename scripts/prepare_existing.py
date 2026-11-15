"""Attach release storage to an existing PetCare installation without moving data."""
import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import sqlite3


def prepare(root):
    root = root.resolve(strict=True)
    env = root / 'app/.env'
    data = root / 'data'
    database = data / 'petcare.db'
    if not env.is_file() or not database.is_file():
        raise RuntimeError('Expected existing app/.env and data/petcare.db; nothing changed')
    shared = root / 'shared'
    links = {shared / '.env': env, shared / 'data': data}
    # Validate all destinations before creating any links.
    for link, target in links.items():
        if link.exists() or link.is_symlink():
            if not link.is_symlink() or link.resolve() != target.resolve():
                raise RuntimeError(f'Refusing to replace existing path: {link}')
    backups = root / 'backups'
    backups.mkdir(mode=0o700, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = backups / f'before-cicd-{stamp}.db'
    # Exclusive creation and SQLite's online backup API; never copy a live DB.
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(fd)
    try:
        with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as source:
            with sqlite3.connect(backup) as destination:
                source.backup(destination)
                if destination.execute('PRAGMA integrity_check').fetchone() != ('ok',):
                    raise RuntimeError('Backup integrity check failed')
    except Exception:
        backup.unlink()
        raise
    shared.mkdir(mode=0o700, exist_ok=True)
    for link, target in links.items():
        if not link.is_symlink():
            link.symlink_to(target, target_is_directory=target.is_dir())
    print('Prepared shared storage. Original data, .env and dispatcher remain in place.')
    print('SQLite backup:', backup)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('/var/www/u3340622/data/petcare-regru'))
    prepare(parser.parse_args().root)
