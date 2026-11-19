"""Persistent login limits, admin support settings and session peer addresses."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

revision = '20261118_admin'
down_revision = '20261117_mysql'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('admin_login', sa.String(64), nullable=True))
        batch.create_unique_constraint('uq_users_admin_login', ['admin_login'])
    op.add_column('login_sessions', sa.Column('ip_address', sa.String(45), nullable=True))
    op.create_table(
        'login_guards',
        sa.Column('key', sa.String(80), primary_key=True),
        sa.Column('failures', sa.Integer(), nullable=False),
        sa.Column('blocked_until', sa.DateTime().with_variant(DATETIME(fsp=6), 'mysql'), nullable=True),
    )
    op.create_table(
        'site_settings',
        sa.Column('key', sa.String(60), primary_key=True),
        sa.Column('value', sa.String(500), nullable=False),
    )


def downgrade():
    op.drop_table('site_settings')
    op.drop_table('login_guards')
    op.drop_column('login_sessions', 'ip_address')
    with op.batch_alter_table('users') as batch:
        batch.drop_constraint('uq_users_admin_login', type_='unique')
        batch.drop_column('admin_login')
