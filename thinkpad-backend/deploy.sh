#!/usr/bin/env bash
#
# Deploy the ThinkPad backend crons from this repo to the server.
#
# Reads DEPLOY_HOST / DEPLOY_PATH from .deploy.local (gitignored — keeps infra
# details off the public repo). Backs up the live CODE (never .env, never
# runtime state), rsyncs the source with --delete so removed files actually
# disappear, then re-registers the PM2 apps and saves the process list.
#
# Runtime state on the server is protected by excludes: .env, node_modules,
# logs/, locks/, backups/, data/, reports/, marketing/.
#
# Usage:  ./deploy.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .deploy.local ]]; then
  echo "✗ .deploy.local not found." >&2
  echo "  Create it with: DEPLOY_HOST=user@host  DEPLOY_PATH=/home/user/manicbot-backend" >&2
  exit 1
fi
# shellcheck disable=SC1091
source .deploy.local
: "${DEPLOY_HOST:?set DEPLOY_HOST in .deploy.local}"
: "${DEPLOY_PATH:?set DEPLOY_PATH in .deploy.local}"

SSH_OPTS="-o ConnectTimeout=15 -o BatchMode=yes"
STAMP="$(date +%Y%m%d-%H%M%S)"

EXCLUDES=(
  --exclude '.env'
  --exclude '.deploy.local'
  --exclude 'node_modules'
  --exclude 'logs'
  --exclude 'locks'
  --exclude 'backups'
  --exclude 'data'
  --exclude 'reports'
  --exclude 'marketing'
)

echo "▶ Backing up live code → ${DEPLOY_PATH}.bak.${STAMP} (no secrets, no state)"
ssh $SSH_OPTS "$DEPLOY_HOST" \
  "rsync -a --exclude '.env' --exclude 'node_modules' --exclude 'logs' --exclude 'locks' \
         --exclude 'backups' --exclude 'data' --exclude 'reports' --exclude 'marketing' \
         '${DEPLOY_PATH}/' '${DEPLOY_PATH}.bak.${STAMP}/' && \
   ls -dt '${DEPLOY_PATH}.bak.'* 2>/dev/null | tail -n +3 | xargs -r rm -rf"  # keep last 2 backups

echo "▶ Syncing source (state and secrets stay on the server)…"
rsync -az --delete \
  -e "ssh $SSH_OPTS" \
  "${EXCLUDES[@]}" \
  ./ "$DEPLOY_HOST:$DEPLOY_PATH/"

echo "▶ Installing the desktop one-button script…"
ssh $SSH_OPTS "$DEPLOY_HOST" \
  "install -m 755 '${DEPLOY_PATH}/scripts/run-all-crons.sh' \"\$HOME/Рабочий стол/run_all_crons.sh\" 2>/dev/null || true"

echo "▶ Running tests on the server…"
ssh $SSH_OPTS "$DEPLOY_HOST" "cd '$DEPLOY_PATH' && npm test --silent 2>&1 | tail -4"

echo "▶ Re-registering PM2 apps…"
ssh $SSH_OPTS "$DEPLOY_HOST" "cd '$DEPLOY_PATH' && pm2 startOrReload ecosystem.config.js --update-env && pm2 save && pm2 ls"

echo "✓ Deploy complete."
