"""Keep a durable inbox and track push broadcast deliveries."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import DATETIME, MEDIUMTEXT

revision = '20261126_inbox'
down_revision = '20261119_premium'
branch_labels = None
depends_on = None


def upgrade():
    timestamp = sa.DateTime().with_variant(DATETIME(fsp=6), 'mysql')
    op.create_table(
        'inbox_notices',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('key', sa.String(64), nullable=False, unique=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('title', sa.String(120), nullable=False),
        sa.Column('body', sa.Text().with_variant(MEDIUMTEXT(), 'mysql'), nullable=False),
        sa.Column('created_at', timestamp, nullable=False),
    )
    op.create_index('ix_inbox_notices_user_id_id', 'inbox_notices', ['user_id', 'id'])
    op.create_table(
        'broadcast_deliveries',
        sa.Column('notice_id', sa.Integer(), sa.ForeignKey('inbox_notices.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('subscription_id', sa.Integer(), sa.ForeignKey('push_subscriptions.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('retry_at', timestamp),
    )


def downgrade():
    op.drop_table('broadcast_deliveries')
    op.drop_table('inbox_notices')
