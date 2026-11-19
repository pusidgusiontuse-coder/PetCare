"""Store the selected appearance on the user's account."""

from alembic import op
import sqlalchemy as sa

revision = '20261119_theme'
down_revision = '20261118_admin'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('theme', sa.String(24), nullable=False, server_default='olive-honey'))


def downgrade():
    op.drop_column('users', 'theme')
