from unittest.mock import MagicMock

import pytest

from db_security import assert_runtime_permissions


@pytest.mark.parametrize(('scope', 'partial_revokes', 'allowed'), [
    (r'`u123\_petcare`.*', False, True),
    ('`u123_petcare`.*', False, False),
    ('`u123_petcare`.*', True, True),
    ('`u123%`.*', True, False),
    ('`U123_PETCARE`.*', True, False),
    ('*.*', False, False),
])
def test_mysql_runtime_requires_a_literal_database_scope(scope, partial_revokes, allowed):
    engine = MagicMock()
    engine.dialect.name = 'mysql'
    engine.url.database = 'u123_petcare'
    connection = engine.connect.return_value.__enter__.return_value
    connection.scalar.return_value = partial_revokes
    connection.execute.return_value = [
        ("GRANT USAGE ON *.* TO `runtime`@`localhost`",),
        (f"GRANT SELECT, INSERT, UPDATE, DELETE ON {scope} TO `runtime`@`localhost`",),
    ]
    if allowed:
        assert_runtime_permissions(engine)
    else:
        with pytest.raises(RuntimeError, match='limited to the application database'):
            assert_runtime_permissions(engine)
