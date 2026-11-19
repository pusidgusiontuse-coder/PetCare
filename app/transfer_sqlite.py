"""Copy a stopped SQLite database to an empty, migrated PostgreSQL or MySQL database.

Run from repository root: python app/transfer_sqlite.py /private/backup.db
DATABASE_URL supplies the destination; never pass credentials on the command line.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile

from sqlalchemy import Boolean, Column, MetaData, Table, create_engine, func, inspect, select, text
from sqlalchemy.engine import URL

import models
from connection_config import validate_url
from dotenv import load_dotenv
from schema import check_schema


class TransferError(RuntimeError):
    pass


def digest_rows(connection, table, columns):
    digest = hashlib.sha256()
    count = 0
    query = select(*(table.c[name] for name in columns)).order_by(*table.primary_key.columns)
    for row in connection.execute(query).yield_per(250):
        payload = json.dumps(list(row), default=str, ensure_ascii=False, allow_nan=False)
        digest.update((payload + '\n').encode('utf8'))
        count += 1
    return count, digest.hexdigest()


def reset_sequences(connection, tables):
    if connection.dialect.name == 'mysql': return  # Explicit integer inserts advance AUTO_INCREMENT.
    quote = connection.dialect.identifier_preparer.quote
    for table in tables:
        for column in table.primary_key:
            if not isinstance(column.type, models.Integer) or column is not table.autoincrement_column:
                continue
            sequence = connection.execute(text('''
                SELECT n.nspname, c.relname FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.oid = CAST(pg_get_serial_sequence(:table, :column) AS regclass)
            '''), {'table': table.name, 'column': column.name}).first()
            if sequence:
                maximum = connection.scalar(select(func.max(column)))
                next_id = max(1, (maximum or 0) + 1)
                # Transactional restart: failed imports roll back sequence changes too.
                connection.execute(text(
                    f'ALTER SEQUENCE {quote(sequence[0])}.{quote(sequence[1])} RESTART WITH {int(next_id)}'
                ))


def copy_snapshot(snapshot, destination):
    source_engine = create_engine(URL.create('sqlite', database=str(snapshot)))
    try:
        metadata = MetaData()
        metadata.reflect(source_engine)
        tables = models.Base.metadata.sorted_tables
        unknown = set(metadata.tables) - {t.name for t in tables} - {'alembic_version'}
        missing = {t.name for t in tables} - set(metadata.tables)
        if missing:
            raise TransferError('Missing source tables; upgrade a COPY with the previous release first: ' + ', '.join(sorted(missing)))
        if unknown:
            raise TransferError('Unknown source tables; review schema before transfer: ' + ', '.join(sorted(unknown)))
        with source_engine.connect() as source, destination.begin() as target:
            if target.dialect.name == 'postgresql':
                target.execute(text("SET LOCAL lock_timeout = '10s'"))
            quote = target.dialect.identifier_preparer.quote
            if target.dialect.name == 'postgresql':
                target.execute(text('LOCK TABLE ' + ', '.join(quote(t.name) for t in tables) + ' IN ACCESS EXCLUSIVE MODE'))
            elif target.dialect.name == 'mysql':
                target.execute(text("SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'"))
            for table in tables:
                if target.scalar(select(func.count()).select_from(table)):
                    raise TransferError('Destination is not empty; use a new database')
            report = {}
            for table in tables:
                original = metadata.tables[table.name]
                if set(original.c.keys()) != set(table.c.keys()):
                    raise TransferError(f'Schema mismatch in {table.name}; upgrade a COPY with the previous release first')
                for column in table.columns:
                    if isinstance(column.type, Boolean):
                        invalid = source.scalar(text(
                            f'SELECT COUNT(*) FROM {quote(table.name)} WHERE {quote(column.name)} NOT IN (0, 1)'
                        ))
                        if invalid:
                            raise TransferError(f'Invalid boolean values in {table.name}.{column.name}')
                # Select using destination types: enforce dates/booleans consistently.
                typed_source = Table(table.name, MetaData(), *(Column(c.name, c.type, primary_key=c.primary_key) for c in table.columns))
                query = select(typed_source).order_by(*typed_source.primary_key.columns)
                for batch in source.execute(query).mappings().partitions(250):
                    rows = [dict(row) for row in batch]
                    if rows:
                        target.execute(table.insert(), rows)
                columns = list(table.c.keys())
                expected = digest_rows(source, typed_source, columns)
                actual = digest_rows(target, table, columns)
                if expected != actual:
                    raise TransferError(f'Verification failed for {table.name}; transaction rolled back')
                report[table.name] = {'rows': actual[0], 'sha256': actual[1]}
            reset_sequences(target, tables)
        return report
    finally:
        source_engine.dispose()


# Only fields introduced since the REG.RU SQLite release may be synthesized.
LEGACY_COLUMNS = {
    'users': {
        'admin_login': 'VARCHAR(64)',
        'disabled': 'BOOLEAN NOT NULL DEFAULT 0',
        'email_verified': 'BOOLEAN NOT NULL DEFAULT 0',
        'is_admin': 'BOOLEAN NOT NULL DEFAULT 0',
        'premium_permanent': 'BOOLEAN NOT NULL DEFAULT 0',
        'premium_until': 'DATETIME',
        'token_version': 'INTEGER NOT NULL DEFAULT 0',
    },
    'login_sessions': {'ip_address': 'VARCHAR(45)'},
    'pet_members': {'expires_at': 'DATETIME'},
    'match_profiles': {'photos': 'JSON'},
    'reminders': {'prescription_id': 'INTEGER REFERENCES prescriptions(id)'},
}
LEGACY_NEW_TABLES = {
    'admin_audit', 'delivery_receipts', 'email_challenges', 'login_sessions',
    'login_guards', 'site_settings', 'notification_preferences', 'push_subscriptions', 'recovery_actions', 'request_quotas',
}


def normalize_legacy_snapshot(snapshot):
    """Extend only the disposable copy of a recognized older PetCare schema."""
    engine = create_engine(URL.create('sqlite', database=str(snapshot)))
    try:
        with engine.begin() as connection:
            inspector = inspect(connection)
            existing = set(inspector.get_table_names()) - {'alembic_version'}
            current = models.Base.metadata.tables
            if existing - set(current) or set(current) - existing - LEGACY_NEW_TABLES:
                raise TransferError('Unrecognized legacy table layout')
            for name in sorted(existing):
                old_columns = {column['name'] for column in inspector.get_columns(name)}
                new_columns = set(current[name].c.keys())
                allowed = LEGACY_COLUMNS.get(name, {})
                if old_columns - new_columns or new_columns - old_columns - set(allowed):
                    raise TransferError(f'Unrecognized legacy columns in {name}')
                for column in sorted(new_columns - old_columns):
                    connection.exec_driver_sql(f'ALTER TABLE "{name}" ADD COLUMN "{column}" {allowed[column]}')
            models.Base.metadata.create_all(connection, tables=[current[name] for name in sorted(set(current) - existing)])
    finally:
        engine.dispose()


def transfer(source_path, destination=None, *, legacy_regru=False):
    if destination is None:
        load_dotenv(os.environ.get('PETCARE_ENV_FILE', Path(__file__).resolve().parent / '.env'))
        url = os.environ.get('MIGRATION_DATABASE_URL') or os.environ.get('DATABASE_URL')
        if not url or os.getenv('APP_ENV') == 'production' and not os.environ.get('MIGRATION_DATABASE_URL'):
            raise TransferError('Use a separate migration environment with MIGRATION_DATABASE_URL')
        migration_engine = create_engine(validate_url(url, os.getenv('APP_ENV') == 'production'), hide_parameters=True)
        try: return transfer(source_path, migration_engine, legacy_regru=legacy_regru)
        finally: migration_engine.dispose()
    if destination.dialect.name not in {'postgresql','mysql'}:
        raise TransferError('Destination must be PostgreSQL or MySQL')
    source_path = Path(source_path).expanduser().resolve(strict=True)
    check_schema(destination)
    # SQLite backup API includes committed WAL pages; original file stays read-only.
    with tempfile.TemporaryDirectory(prefix='petcare-transfer-') as directory:
        snapshot = Path(directory) / 'snapshot.db'
        fd = os.open(snapshot, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
        with sqlite3.connect(source_path.as_uri() + '?mode=ro', uri=True) as source:
            with sqlite3.connect(snapshot) as backup:
                source.backup(backup)
                if backup.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                    raise TransferError('SQLite integrity check failed')
                if backup.execute('PRAGMA foreign_key_check').fetchone():
                    raise TransferError('SQLite contains broken foreign keys; fix a COPY before transfer')
        if legacy_regru:
            normalize_legacy_snapshot(snapshot)
        return copy_snapshot(snapshot, destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--legacy-regru', action='store_true', help='Extend known legacy fields on a disposable snapshot')
    args = parser.parse_args()
    try:
        report = transfer(args.source, legacy_regru=args.legacy_regru)
    except Exception as exc:
        # Driver errors can contain passwords, email addresses and document data.
        detail = str(exc) if isinstance(exc, TransferError) else type(exc).__name__
        raise SystemExit('Transfer failed (no application rows committed): ' + detail) from None
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
