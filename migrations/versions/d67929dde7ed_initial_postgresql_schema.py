"""Initial PostgreSQL schema. Keep immutable after deployment."""
from alembic import op
import sqlalchemy as sa

revision = 'd67929dde7ed'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('admin_audit',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('actor_id', sa.Integer(), nullable=False),
    sa.Column('target_id', sa.Integer(), nullable=False),
    sa.Column('action', sa.String(length=100), nullable=False),
    sa.Column('at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('delivery_receipts',
    sa.Column('key', sa.String(length=64), nullable=False),
    sa.Column('sent_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('email_challenges',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('purpose', sa.String(length=40), nullable=False),
    sa.Column('code_hash', sa.String(length=64), nullable=False),
    sa.Column('payload', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('expires_at', sa.DateTime(), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('consumed', sa.Boolean(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_email_challenges_email'), 'email_challenges', ['email'], unique=False)
    op.create_index(op.f('ix_email_challenges_user_id'), 'email_challenges', ['user_id'], unique=False)
    op.create_table('recovery_actions',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('pet_id', sa.Integer(), nullable=False),
    sa.Column('data', sa.Text(), nullable=False),
    sa.Column('expires_at', sa.DateTime(), nullable=False),
    sa.Column('consumed', sa.Boolean(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('request_quotas',
    sa.Column('key', sa.String(length=100), nullable=False),
    sa.Column('count', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('full_name', sa.String(length=100), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('hashed_password', sa.String(length=255), nullable=False),
    sa.Column('timezone', sa.String(length=50), nullable=False),
    sa.Column('disabled', sa.Boolean(), nullable=False),
    sa.Column('is_admin', sa.Boolean(), nullable=False),
    sa.Column('premium_until', sa.DateTime(), nullable=True),
    sa.Column('premium_permanent', sa.Boolean(), nullable=False),
    sa.Column('email_verified', sa.Boolean(), nullable=False),
    sa.Column('token_version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_index(op.f('ix_users_id'), 'users', ['id'], unique=False)
    op.create_table('login_sessions',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('expires_at', sa.DateTime(), nullable=False),
    sa.Column('revoked', sa.Boolean(), nullable=False),
    sa.Column('device', sa.String(length=200), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_login_sessions_user_id'), 'login_sessions', ['user_id'], unique=False)
    op.create_table('notification_preferences',
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('data', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('user_id')
    )
    op.create_table('pets',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('owner_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('species', sa.String(length=50), nullable=False),
    sa.Column('breed', sa.String(length=100), nullable=False),
    sa.Column('birth_date', sa.Date(), nullable=False),
    sa.Column('sex', sa.String(length=20), nullable=True),
    sa.Column('sterilized', sa.Boolean(), nullable=True),
    sa.Column('microchip_number', sa.String(length=100), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('marks', sa.Text(), nullable=True),
    sa.Column('photo_file_id', sa.Text(), nullable=True),
    sa.Column('clinic_url', sa.String(length=500), nullable=True),
    sa.Column('doctor_name', sa.String(length=200), nullable=True),
    sa.Column('avatar_bg', sa.String(length=50), nullable=True),
    sa.Column('avatar_accessory', sa.String(length=50), nullable=True),
    sa.Column('share_code', sa.String(length=64), nullable=True),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_pets_id'), 'pets', ['id'], unique=False)
    op.create_index(op.f('ix_pets_share_code'), 'pets', ['share_code'], unique=True)
    op.create_table('push_subscriptions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('endpoint', sa.Text().with_variant(sa.String(768, collation='utf8mb4_bin'), 'mysql'), nullable=False),
    sa.Column('data', sa.Text(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('endpoint')
    )
    op.create_index(op.f('ix_push_subscriptions_user_id'), 'push_subscriptions', ['user_id'], unique=False)
    op.create_table('activity_logs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('pet_id', sa.Integer(), nullable=False),
    sa.Column('actor', sa.String(length=100), nullable=True),
    sa.Column('action', sa.String(length=255), nullable=False),
    sa.Column('icon', sa.String(length=20), nullable=True),
    sa.Column('at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['pet_id'], ['pets.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_activity_logs_id'), 'activity_logs', ['id'], unique=False)
    op.create_table('documents',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('pet_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('doc_type', sa.String(length=50), nullable=True),
    sa.Column('date', sa.Date(), nullable=True),
    sa.Column('file_name', sa.String(length=255), nullable=True),
    sa.Column('file_data', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['pet_id'], ['pets.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_documents_id'), 'documents', ['id'], unique=False)
    op.create_table('feeding_logs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('pet_id', sa.Integer(), nullable=False),
    sa.Column('food', sa.String(length=200), nullable=False),
    sa.Column('amount', sa.String(length=100), nullable=True),
    sa.Column('at', sa.DateTime(), nullable=True),
    sa.Column('actor', sa.String(length=100), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('meal_plan_id', sa.Integer(), nullable=True),
    sa.Column('reminder_id', sa.Integer(), nullable=True),
    sa.Column('completion_day', sa.String(length=20), nullable=True),
    sa.ForeignKeyConstraint(['pet_id'], ['pets.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_feeding_logs_id'), 'feeding_logs', ['id'], unique=False)
    op.create_table('health_records',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('pet_id', sa.Integer(), nullable=False),
    sa.Column('record_type', sa.String(length=50), nullable=False),
    sa.Column('event_date', sa.Date(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('weight', sa.Float(), nullable=True),
    sa.Column('vet_conclusion', sa.Text(), nullable=True),
    sa.Column('medicine_name', sa.String(length=200), nullable=True),
    sa.Column('clinic', sa.String(length=200), nullable=True),
    sa.Column('doctor', sa.String(length=100), nullable=True),
    sa.Column('result', sa.Text(), nullable=True),
    sa.Column('comment', sa.Text(), nullable=True),
    sa.Column('next_date', sa.Date(), nullable=True),
    sa.Column('file_name', sa.String(length=255), nullable=True),
    sa.Column('file_data', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['pet_id'], ['pets.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_health_records_id'), 'health_records', ['id'], unique=False)
    op.create_table('match_profiles',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('pet_id', sa.Integer(), nullable=True),
    sa.Column('owner_id', sa.Integer(), nullable=True),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('species', sa.String(length=100), nullable=False),
    sa.Column('breed', sa.String(length=150), nullable=True),
    sa.Column('birth_date', sa.String(length=40), nullable=True),
    sa.Column('sex', sa.String(length=40), nullable=True),
    sa.Column('vaccinated', sa.String(length=100), nullable=True),
    sa.Column('sterilized', sa.String(length=40), nullable=True),
    sa.Column('purpose', sa.String(length=120), nullable=True),
    sa.Column('city', sa.String(length=120), nullable=True),
    sa.Column('bio', sa.Text(), nullable=True),
    sa.Column('owner_name', sa.String(length=120), nullable=True),
    sa.Column('owner_contact', sa.String(length=255), nullable=False),
    sa.Column('photo', sa.Text(), nullable=True),
    sa.Column('is_published', sa.Boolean(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['pet_id'], ['pets.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_match_profiles_id'), 'match_profiles', ['id'], unique=False)
    op.create_index(op.f('ix_match_profiles_pet_id'), 'match_profiles', ['pet_id'], unique=False)
    op.create_table('meal_plans',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('pet_id', sa.Integer(), nullable=False),
    sa.Column('food', sa.String(length=200), nullable=False),
    sa.Column('time', sa.String(length=20), nullable=False),
    sa.Column('end_time', sa.String(length=20), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('completed_on', sa.String(length=20), nullable=True),
    sa.ForeignKeyConstraint(['pet_id'], ['pets.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_meal_plans_id'), 'meal_plans', ['id'], unique=False)
    op.create_table('nutrition_logs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('pet_id', sa.Integer(), nullable=False),
    sa.Column('food_name', sa.String(length=150), nullable=False),
    sa.Column('brand', sa.String(length=100), nullable=True),
    sa.Column('kind', sa.String(length=50), nullable=True),
    sa.Column('liked', sa.String(length=20), nullable=True),
    sa.Column('tolerated', sa.String(length=20), nullable=True),
    sa.Column('adverse_reactions', sa.Text(), nullable=True),
    sa.Column('price', sa.Float(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('date', sa.Date(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['pet_id'], ['pets.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_nutrition_logs_id'), 'nutrition_logs', ['id'], unique=False)
    op.create_table('pet_members',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('pet_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('role', sa.String(length=50), nullable=True),
    sa.Column('expires_at', sa.DateTime(), nullable=True),
    sa.Column('joined_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['pet_id'], ['pets.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_pet_members_id'), 'pet_members', ['id'], unique=False)
    op.create_table('prescriptions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('pet_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('dose', sa.String(length=100), nullable=True),
    sa.Column('start_date', sa.Date(), nullable=False),
    sa.Column('duration', sa.String(length=100), nullable=True),
    sa.Column('times', sa.String(length=100), nullable=True),
    sa.Column('status', sa.String(length=50), nullable=True),
    sa.ForeignKeyConstraint(['pet_id'], ['pets.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_prescriptions_id'), 'prescriptions', ['id'], unique=False)
    op.create_table('reminders',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('pet_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('reminder_type', sa.String(length=50), nullable=False),
    sa.Column('due_date', sa.Date(), nullable=False),
    sa.Column('due_time', sa.String(length=20), nullable=True),
    sa.Column('at', sa.String(length=50), nullable=True),
    sa.Column('interval_days', sa.Integer(), nullable=True),
    sa.Column('interval_months', sa.Integer(), nullable=True),
    sa.Column('food', sa.String(length=200), nullable=True),
    sa.Column('status', sa.String(length=50), nullable=True),
    sa.Column('is_completed', sa.Boolean(), nullable=True),
    sa.Column('done_by', sa.String(length=100), nullable=True),
    sa.Column('completed_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['pet_id'], ['pets.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_reminders_id'), 'reminders', ['id'], unique=False)
    op.create_table('shopping_items',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('pet_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('quantity', sa.String(length=100), nullable=True),
    sa.Column('is_done', sa.Boolean(), nullable=True),
    sa.Column('bought_by', sa.String(length=100), nullable=True),
    sa.ForeignKeyConstraint(['pet_id'], ['pets.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_shopping_items_id'), 'shopping_items', ['id'], unique=False)
    op.create_table('weight_records',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('pet_id', sa.Integer(), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('kg', sa.Float(), nullable=False),
    sa.ForeignKeyConstraint(['pet_id'], ['pets.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_weight_records_id'), 'weight_records', ['id'], unique=False)
    op.create_table('match_decisions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('from_pet_id', sa.Integer(), nullable=False),
    sa.Column('to_profile_id', sa.Integer(), nullable=False),
    sa.Column('to_pet_id', sa.Integer(), nullable=True),
    sa.Column('decision', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['from_pet_id'], ['pets.id'], ),
    sa.ForeignKeyConstraint(['to_profile_id'], ['match_profiles.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_match_decisions_from_pet_id'), 'match_decisions', ['from_pet_id'], unique=False)
    op.create_index(op.f('ix_match_decisions_id'), 'match_decisions', ['id'], unique=False)
    op.create_index(op.f('ix_match_decisions_to_pet_id'), 'match_decisions', ['to_pet_id'], unique=False)
    op.create_index(op.f('ix_match_decisions_to_profile_id'), 'match_decisions', ['to_profile_id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_match_decisions_to_profile_id'), table_name='match_decisions')
    op.drop_index(op.f('ix_match_decisions_to_pet_id'), table_name='match_decisions')
    op.drop_index(op.f('ix_match_decisions_id'), table_name='match_decisions')
    op.drop_index(op.f('ix_match_decisions_from_pet_id'), table_name='match_decisions')
    op.drop_table('match_decisions')
    op.drop_index(op.f('ix_weight_records_id'), table_name='weight_records')
    op.drop_table('weight_records')
    op.drop_index(op.f('ix_shopping_items_id'), table_name='shopping_items')
    op.drop_table('shopping_items')
    op.drop_index(op.f('ix_reminders_id'), table_name='reminders')
    op.drop_table('reminders')
    op.drop_index(op.f('ix_prescriptions_id'), table_name='prescriptions')
    op.drop_table('prescriptions')
    op.drop_index(op.f('ix_pet_members_id'), table_name='pet_members')
    op.drop_table('pet_members')
    op.drop_index(op.f('ix_nutrition_logs_id'), table_name='nutrition_logs')
    op.drop_table('nutrition_logs')
    op.drop_index(op.f('ix_meal_plans_id'), table_name='meal_plans')
    op.drop_table('meal_plans')
    op.drop_index(op.f('ix_match_profiles_pet_id'), table_name='match_profiles')
    op.drop_index(op.f('ix_match_profiles_id'), table_name='match_profiles')
    op.drop_table('match_profiles')
    op.drop_index(op.f('ix_health_records_id'), table_name='health_records')
    op.drop_table('health_records')
    op.drop_index(op.f('ix_feeding_logs_id'), table_name='feeding_logs')
    op.drop_table('feeding_logs')
    op.drop_index(op.f('ix_documents_id'), table_name='documents')
    op.drop_table('documents')
    op.drop_index(op.f('ix_activity_logs_id'), table_name='activity_logs')
    op.drop_table('activity_logs')
    op.drop_index(op.f('ix_push_subscriptions_user_id'), table_name='push_subscriptions')
    op.drop_table('push_subscriptions')
    op.drop_index(op.f('ix_pets_share_code'), table_name='pets')
    op.drop_index(op.f('ix_pets_id'), table_name='pets')
    op.drop_table('pets')
    op.drop_table('notification_preferences')
    op.drop_index(op.f('ix_login_sessions_user_id'), table_name='login_sessions')
    op.drop_table('login_sessions')
    op.drop_index(op.f('ix_users_id'), table_name='users')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    op.drop_table('request_quotas')
    op.drop_table('recovery_actions')
    op.drop_index(op.f('ix_email_challenges_user_id'), table_name='email_challenges')
    op.drop_index(op.f('ix_email_challenges_email'), table_name='email_challenges')
    op.drop_table('email_challenges')
    op.drop_table('delivery_receipts')
    op.drop_table('admin_audit')
