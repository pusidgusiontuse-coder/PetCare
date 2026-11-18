"""Provision data-only, migration and read-only backup roles in a dedicated DB.

Credentials are read only from the process environment (not command arguments).
Run --roles, apply Alembic using migration credentials, then run --grants.
"""
import argparse
import os
from pathlib import Path
import sys

import psycopg
from psycopg import sql
from sqlalchemy.engine import make_url
from dotenv import load_dotenv
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from connection_config import validate_url


def provision(connection, schema, roles, *, create_roles=False, grants=False, adopt=False):
    database = connection.execute('SELECT current_database()').fetchone()[0]
    if database in {'postgres', 'template0', 'template1'}:
        raise ValueError('Use a dedicated PetCare database')
    app, migrator, backup = (roles[name][0] for name in ('app', 'migrator', 'backup'))
    if len({app, migrator, backup}) != 3: raise ValueError('Three different database roles are required')
    ident = sql.Identifier
    if create_roles:
        for key, (name, password) in roles.items():
            if not password or len(password) < 20 or password.startswith(('CHANGE', 'GENERATE', 'REPLACE')): raise ValueError('Use generated role passwords of at least 20 characters')
            if connection.execute('SELECT 1 FROM pg_roles WHERE rolname=%s', (name,)).fetchone():
                raise ValueError('Role already exists; do not reuse roles across installations')
            # No secret is printed or placed in command arguments.
            encrypted = connection.pgconn.encrypt_password(password.encode(), name.encode(), b'scram-sha-256').decode()
            connection.execute(sql.SQL('CREATE ROLE {} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT {} PASSWORD {}').format(
                ident(name), sql.Literal(20 if key == 'app' else 2), sql.Literal(encrypted)))
        connection.execute(sql.SQL('REVOKE ALL ON DATABASE {} FROM PUBLIC').format(ident(database)))
        for name in (app, migrator, backup):
            connection.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO {}').format(ident(database), ident(name)))
        connection.execute(sql.SQL('CREATE SCHEMA IF NOT EXISTS {} AUTHORIZATION {}').format(ident(schema), ident(migrator)))
        # Existing schemas are only reassigned under the explicit adopt option.
        owner = connection.execute('SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname=%s', (schema,)).fetchone()[0]
        if owner != migrator:
            if not adopt: raise ValueError('Schema already exists; use --adopt-existing for a dedicated existing database')
            connection.execute(sql.SQL('ALTER SCHEMA {} OWNER TO {}').format(ident(schema), ident(migrator)))
        connection.execute(sql.SQL('REVOKE ALL ON SCHEMA {} FROM PUBLIC').format(ident(schema)))
        for name in (app, backup):
            connection.execute(sql.SQL('GRANT USAGE ON SCHEMA {} TO {}').format(ident(schema), ident(name)))
        for name in (app, migrator, backup):
            connection.execute(sql.SQL('ALTER ROLE {} IN DATABASE {} SET search_path TO {}').format(ident(name), ident(database), ident(schema)))
        connection.execute(sql.SQL('ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA {} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {}').format(ident(migrator), ident(schema), ident(app)))
        connection.execute(sql.SQL('ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA {} GRANT USAGE, SELECT ON SEQUENCES TO {}').format(ident(migrator), ident(schema), ident(app)))
        connection.execute(sql.SQL('ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA {} GRANT SELECT ON TABLES TO {}').format(ident(migrator), ident(schema), ident(backup)))
        connection.execute(sql.SQL('ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA {} GRANT SELECT ON SEQUENCES TO {}').format(ident(migrator), ident(schema), ident(backup)))
    if grants:
        if adopt:
            rows = connection.execute("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=%s AND c.relkind='r'", (schema,)).fetchall()
            for (name,) in rows:
                connection.execute(sql.SQL('ALTER TABLE {}.{} OWNER TO {}').format(ident(schema), ident(name), ident(migrator)))
        connection.execute(sql.SQL('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA {} TO {}').format(ident(schema), ident(app)))
        connection.execute(sql.SQL('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {} TO {}').format(ident(schema), ident(app)))
        connection.execute(sql.SQL('GRANT SELECT ON ALL TABLES IN SCHEMA {} TO {}').format(ident(schema), ident(backup)))
        connection.execute(sql.SQL('GRANT SELECT ON ALL SEQUENCES IN SCHEMA {} TO {}').format(ident(schema), ident(backup)))
        connection.execute(sql.SQL('REVOKE INSERT, UPDATE, DELETE ON {}.alembic_version FROM {}').format(ident(schema), ident(app)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--roles', action='store_true')
    parser.add_argument('--grants', action='store_true')
    parser.add_argument('--adopt-existing', action='store_true')
    args = parser.parse_args()
    if not (args.roles or args.grants): parser.error('Specify --roles or --grants')
    config_path = os.environ.get('PETCARE_PROVISION_ENV_FILE')
    if config_path:
        private = Path(config_path)
        if private.stat().st_mode & 0o077: raise SystemExit('Provisioning environment must be private (0600)')
        load_dotenv(private)
    url = make_url(validate_url(os.environ['PROVISION_DATABASE_URL'], os.getenv('APP_ENV') == 'production'))
    roles = {key: (os.environ['PG_'+key.upper()+'_USER'], os.environ.get('PG_'+key.upper()+'_PASSWORD', '')) for key in ('app', 'migrator', 'backup')}
    try:
        with psycopg.connect(**dict({'host':url.host,'port':url.port,'dbname':url.database,'user':url.username,'password':url.password}, **dict(url.query))) as connection:
            provision(connection, os.getenv('PG_APP_SCHEMA', 'petcare'), roles, create_roles=args.roles, grants=args.grants, adopt=args.adopt_existing)
    except Exception as exc:
        raise SystemExit('Database provisioning failed: ' + type(exc).__name__) from None
    print('Dedicated PostgreSQL role configuration applied')


if __name__ == '__main__': main()
