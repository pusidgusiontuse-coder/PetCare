#!/usr/bin/env bash
# Runs on the hosting server as the unprivileged website owner.
set -euo pipefail
umask 077
root=${1:?}; public=${2:?}; site=${3:?}; python=${4:?}; release=${5:?}
for value in "$root" "$public" "$python"; do
  [[ "$value" =~ ^/[a-zA-Z0-9_./-]+$ ]] && [[ "$value" != *'/../'* ]]
done
[[ "$release" =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]]
[[ "$site" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]]
root=$(realpath "$root")
public=$(realpath "$public")
[[ "$root" != "$public" && "$root" != "$public/"* ]]
[[ -f "$root/shared/.env" && -d "$root/shared/data" ]]
# The existing installer only backs up the standard SQLite path.
"$python" -c 'import pathlib,re,sys; text=pathlib.Path(sys.argv[1]).read_text(); assert not re.search(r"(?m)^\s*(?:export\s+)?DATABASE_URL\s*=", text), "Remove DATABASE_URL: deployment supports the default SQLite path only"' "$root/shared/.env"
[[ ! -e "$public/index.html" && ! -e "$public/index.php" ]]
# Also serialize manual/server-side invocations.
exec 9>"$root/deploy.lock"
flock -w 900 9
incoming="$root/incoming/$release"
cd "$incoming"
sha256sum -c petcare.tar.gz.sha256
mkdir -p "$root/releases" "$root/backups" "$public/tmp"
path="$root/releases/$release"
mkdir "$path"
tar -xzf petcare.tar.gz -C "$path"
ln -s "$root/shared/.env" "$path/app/.env"
ln -s "$root/shared/data" "$path/data"
# setup_hosting backs up SQLite before import-time schema updates. It writes
# the dispatcher into a private staging directory, never over the live file.
"$python" "$path/setup_hosting.py" --upgrade --public-dir "$path/dispatcher"
backup="$root/backups/$release.passenger_wsgi.py"
had_previous=false
if [[ -f "$public/passenger_wsgi.py" ]]; then
  cp -p "$public/passenger_wsgi.py" "$backup"
  had_previous=true
fi
rollback() {
  status=$?
  trap - ERR
  if $had_previous; then
    cp "$backup" "$public/passenger_wsgi.py.next"
    mv -f "$public/passenger_wsgi.py.next" "$public/passenger_wsgi.py"
  else
    rm -f "$public/passenger_wsgi.py"
  fi
  touch "$public/tmp/restart.txt"
  echo "Activation failed; previous dispatcher restored. Database NOT restored; inspect shared/data/before-update-*.db." >&2
  exit "$status"
}
trap rollback ERR
cp "$path/dispatcher/passenger_wsgi.py" "$public/passenger_wsgi.py.next"
chmod 644 "$public/passenger_wsgi.py.next"
mv -f "$public/passenger_wsgi.py.next" "$public/passenger_wsgi.py"
touch "$public/tmp/restart.txt"
healthy=false
for attempt in {1..24}; do
  if curl --fail --silent --show-error --max-time 10 --header 'Cache-Control: no-cache' "$site/api/v1/health" > "$incoming/health.json" &&
    "$python" -c 'import json,sys; assert json.load(open(sys.argv[1]))["release"] == sys.argv[2]' "$incoming/health.json" "${release%%-*}"; then
    healthy=true
    break
  fi
  sleep 5
done
$healthy
ln -s "$path" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
trap - ERR
echo "Deployed $release"
