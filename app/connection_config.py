"""Connection validation shared by web, migration and backup processes."""
from sqlalchemy.engine import make_url


def validate_url(value, production=False):
    if value.startswith(('postgres://', 'postgresql://')):
        value = 'postgresql+psycopg://' + value.split('://', 1)[1]
    if value.startswith('mysql://'):
        value = 'mysql+pymysql://' + value.split('://', 1)[1]
    url = make_url(value)
    if production:
        if url.get_backend_name() not in {'postgresql','mysql'}: raise RuntimeError('Production requires PostgreSQL or MySQL')
        socket = not url.host and str(url.query.get('host', '')).startswith('/')
        if not url.host and not socket: raise RuntimeError('Production requires an explicit database host or Unix socket')
        local = socket or url.host in {'127.0.0.1', '::1', 'localhost'} or str(url.host).startswith('/')
        if url.get_backend_name() == 'mysql' and not local:
            raise RuntimeError('MySQL hosting connections must use localhost or a Unix socket')
        if not local and url.query.get('sslmode') != 'verify-full':
            raise RuntimeError('Remote PostgreSQL requires sslmode=verify-full')
        if not url.password: raise RuntimeError('Production PostgreSQL requires a dedicated password-protected role')
        if any(key in url.query for key in ('user', 'password', 'hostaddr', 'port', 'dbname', 'service', 'servicefile')) or 'host' in url.query and not socket:
            raise RuntimeError('Put connection identity in URL fields, not query overrides')
    if url.get_backend_name() == 'mysql':
        if url.drivername != 'mysql+pymysql': raise RuntimeError('MySQL requires the PyMySQL driver')
        url = url.update_query_dict({'charset':'utf8mb4'})
        return url.render_as_string(hide_password=False)
    return value
