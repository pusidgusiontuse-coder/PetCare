"""Use MySQL document columns large enough for a 10 MB data URL."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import MEDIUMTEXT, DATETIME, DOUBLE
revision = '20261117_mysql'
down_revision = '20261117_gallery'
branch_labels = None
depends_on = None

def upgrade():
    connection = op.get_bind()
    if connection.dialect.name != 'mysql': return
    inspector = sa.inspect(connection)
    for table in inspector.get_table_names():
        for column in inspector.get_columns(table):
            original = column['type']
            replacement = MEDIUMTEXT() if isinstance(original, sa.Text) else DATETIME(fsp=6) if isinstance(original, sa.DateTime) else DOUBLE(asdecimal=False) if isinstance(original, sa.Float) else None
            if replacement is not None:
                op.alter_column(table, column['name'], type_=replacement, existing_type=original, existing_nullable=column['nullable'])

def downgrade():
    # Never shrink stored documents to TEXT's 64 KB limit.
    pass
