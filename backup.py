"""Private PostgreSQL custom-format backup using the configured DATABASE_URL.

Requires pg_dump (same major version as server or newer) in PATH.
Restore into an empty database with pg_restore --no-owner --no-acl.
"""
import argparse
import configparser
import os
from pathlib import Path
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent / 'app'))
from sqlalchemy.engine import make_url
from settings import DATABASE_URL


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', type=Path)
    args = parser.parse_args()
    url = make_url(DATABASE_URL)
    if url.get_backend_name() != 'postgresql':
        raise SystemExit('PostgreSQL DATABASE_URL is required. Use SQLite backup API for the old file.')
    target = args.target.expanduser().resolve()
    # Exclusive, private file; remove partial dumps on failure.
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'wb') as output, tempfile.TemporaryDirectory(prefix='petcare-backup-') as directory:
            service = Path(directory) / 'pg_service.conf'
            config = configparser.ConfigParser(interpolation=None)
            config['petcare_backup'] = {key: str(value) for key, value in {
                'host': url.host, 'port': url.port, 'dbname': url.database,
                'user': url.username, 'password': url.password, **dict(url.query),
            }.items() if value is not None}
            service.touch(mode=0o600)
            with service.open('w') as file:
                config.write(file)
            env = dict(os.environ, PGSERVICEFILE=str(service), PGSERVICE='petcare_backup')
            result = subprocess.run(['pg_dump', '--format=custom', '--no-owner', '--no-acl'],
                                    stdout=output, stderr=subprocess.PIPE, env=env)
            if result.returncode:
                raise RuntimeError('pg_dump failed; check database access and client version')
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    print('Backup saved:', target)


if __name__ == '__main__':
    main()
