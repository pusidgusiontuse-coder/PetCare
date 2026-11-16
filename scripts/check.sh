#!/usr/bin/env bash
# Run with an activated Python 3.12 virtual environment and installed requirements.
set -euo pipefail
cd "$(dirname "$0")/.."
python -c 'import sys; assert sys.version_info[:2] == (3, 12), "Activate a Python 3.12 environment"'
python -m pip check
python -m compileall -q app
# TEST_DATABASE_URL must point to a disposable PostgreSQL database.
: "${TEST_DATABASE_URL:?Set TEST_DATABASE_URL to a separate PostgreSQL test database}"
export SECRET_KEY='ci-only-key-at-least-32-characters-do-not-use-in-production'
export DATABASE_URL="$TEST_DATABASE_URL"
export ENABLE_DEMO_LOGIN=true
python -m alembic upgrade head
python -m pytest app/test_security_features.py app/test_main.py app/test_database_migration.py -q
python -m alembic check
