"""Persist Premium orders and activation state."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME

revision = '20261119_premium'
down_revision = '20261119_theme'
branch_labels = None
depends_on = None


def upgrade():
    timestamp = sa.DateTime().with_variant(DATETIME(fsp=6), 'mysql')
    op.create_table(
        'premium_orders',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('months', sa.Integer(), nullable=False),
        sa.Column('price', sa.Integer(), nullable=False),
        sa.Column('payment_id', sa.String(36), unique=True),
        sa.Column('created_at', timestamp, nullable=False),
        sa.Column('granted_at', timestamp),
    )
    op.create_index('ix_premium_orders_user_id', 'premium_orders', ['user_id'])


def downgrade():
    op.drop_table('premium_orders')
