"""Connection validation shared by web, migration and backup processes."""
from sqlalchemy.engine import make_url


def validate_url(value, production=False):
    if value.startswith(('postgres://', 'postgresql://')):
        value = 'postgresql+psycopg://' + value.split('://', 1)[1]
    url = make_url(value)
    if production:
        if url.get_backend_name() != 'postgresql': raise RuntimeError('Production requires PostgreSQL')
        socket = not url.host and str(url.query.get('host', '')).startswith('/')
        if not url.host and not socket: raise RuntimeError('Production requires an explicit database host or Unix socket')
        local = socket or url.host in {'127.0.0.1', '::1', 'localhost'} or str(url.host).startswith('/')
        if not local and url.query.get('sslmode') != 'verify-full':
            raise RuntimeError('Remote PostgreSQL requires sslmode=verify-full')
        if not url.password: raise RuntimeError('Production PostgreSQL requires a dedicated password-protected role')
        if any(key in url.query for key in ('user', 'password', 'hostaddr', 'port', 'dbname', 'service', 'servicefile')) or 'host' in url.query and not socket:
            raise RuntimeError('Put connection identity in URL fields, not query overrides')
    return value
