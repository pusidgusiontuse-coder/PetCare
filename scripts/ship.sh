#!/usr/bin/env bash
set -euo pipefail
for name in SSH_HOST SSH_USER SSH_PORT SSH_PRIVATE_KEY SSH_KNOWN_HOSTS DEPLOY_ROOT PUBLIC_DIR SITE_URL HOST_PYTHON; do
  test -n "${!name:-}" || { echo "Missing configuration: $name" >&2; exit 1; }
done
# Restrict values that enter the remote shell. No interpolation of arbitrary commands.
[[ "$SSH_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]
[[ "$SSH_USER" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_-]*$ ]]
[[ "$SSH_PORT" =~ ^[0-9]+$ ]]
for value in "$DEPLOY_ROOT" "$PUBLIC_DIR" "$HOST_PYTHON"; do
  [[ "$value" =~ ^/[a-zA-Z0-9_./-]+$ ]] && [[ "$value" != *'/../'* ]]
done
[[ "$SITE_URL" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]]
release="${GITHUB_SHA:?}-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
[[ "$release" =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]]
ssh_dir=$(mktemp -d)
trap 'rm -rf "$ssh_dir"' EXIT
chmod 700 "$ssh_dir"
printf '%s\n' "$SSH_PRIVATE_KEY" > "$ssh_dir/key"
printf '%s\n' "$SSH_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/"*
opts=(-i "$ssh_dir/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts" -o ConnectTimeout=15)
target="$SSH_USER@$SSH_HOST"
remote="$DEPLOY_ROOT/incoming/$release"
ssh "${opts[@]}" -p "$SSH_PORT" "$target" "umask 077; mkdir -p '$remote'"
scp "${opts[@]}" -P "$SSH_PORT" dist/petcare.tar.gz dist/petcare.tar.gz.sha256 scripts/deploy.sh "$target:$remote/"
ssh "${opts[@]}" -p "$SSH_PORT" "$target" "bash '$remote/deploy.sh' '$DEPLOY_ROOT' '$PUBLIC_DIR' '$SITE_URL' '$HOST_PYTHON' '$release'"
