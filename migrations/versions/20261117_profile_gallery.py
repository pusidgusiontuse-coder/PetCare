"""Profile galleries and prescription reminders."""
from alembic import op
import sqlalchemy as sa
revision = '20261117_gallery'
down_revision = 'd67929dde7ed'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('match_profiles', sa.Column('photos', sa.JSON(), nullable=True))
    with op.batch_alter_table('reminders') as batch:
        batch.add_column(sa.Column('prescription_id', sa.Integer(), nullable=True))
        batch.create_foreign_key('fk_reminder_prescription', 'prescriptions', ['prescription_id'], ['id'], ondelete='SET NULL')

def downgrade():
    with op.batch_alter_table('reminders') as batch:
        batch.drop_constraint('fk_reminder_prescription', type_='foreignkey')
        batch.drop_column('prescription_id')
    op.drop_column('match_profiles', 'photos')
