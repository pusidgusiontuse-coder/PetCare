"""Fail closed if a production web process has schema-administration privileges."""
from sqlalchemy import text


def assert_runtime_permissions(engine):
    if engine.dialect.name == 'mysql':
        with engine.connect() as connection:
            grants = [row[0].upper() for row in connection.execute(text('SHOW GRANTS'))]
        allowed = {'SELECT','INSERT','UPDATE','DELETE','USAGE'}
        for grant in grants:
            if not grant.startswith('GRANT ') or ' ON ' not in grant or 'WITH GRANT OPTION' in grant:
                raise RuntimeError('MySQL runtime role must have data-only privileges')
            privileges = set(item.strip() for item in grant[6:].split(' ON ',1)[0].split(','))
            scope = grant.split(' ON ',1)[1].split(' TO ',1)[0].replace('`','')
            if scope != engine.url.database.upper() + '.*' and not (scope == '*.*' and privileges == {'USAGE'}):
                raise RuntimeError('MySQL runtime grants must be limited to the application database')
            if not privileges.issubset(allowed):
                raise RuntimeError('MySQL runtime role must have only SELECT, INSERT, UPDATE, DELETE privileges')
        return
    if engine.dialect.name != 'postgresql':
        raise RuntimeError('Runtime permission checks require PostgreSQL')
    with engine.connect() as connection:
        unsafe = connection.scalar(text('''
            SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
            FROM pg_roles WHERE rolname = current_user
        '''))
        create_schema = connection.scalar(text("SELECT has_database_privilege(current_database(), 'CREATE') OR has_schema_privilege(current_schema(), 'CREATE')"))
        owns_objects = connection.scalar(text('''
            SELECT EXISTS (
                SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname=current_schema() AND c.relkind IN ('r','S')
                AND pg_has_role(current_user, c.relowner, 'MEMBER')
            )
        '''))
        version_write = connection.scalar(text("SELECT has_table_privilege('alembic_version', 'INSERT,UPDATE,DELETE')"))
        if unsafe or create_schema or owns_objects or version_write:
            raise RuntimeError('Web database role must have data-only privileges; run scripts/provision_postgres.py with separate administrator credentials')
