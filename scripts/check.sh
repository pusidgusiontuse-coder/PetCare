#!/usr/bin/env bash
# Run with an activated Python 3.12 virtual environment and installed requirements.
set -euo pipefail
cd "$(dirname "$0")/.."
python -c 'import sys; assert sys.version_info[:2] == (3, 12), "Activate a Python 3.12 environment"'
python -m pip check
python -m compileall -q app
ci_tmp=$(mktemp -d)
trap 'rm -rf "$ci_tmp"' EXIT
export SECRET_KEY='ci-only-key-at-least-32-characters-do-not-use-in-production'
export DATABASE_URL="sqlite:///$ci_tmp/petcare.db"
export ENABLE_DEMO_LOGIN=true
python -m pytest app/test_security_features.py app/test_main.py -q
