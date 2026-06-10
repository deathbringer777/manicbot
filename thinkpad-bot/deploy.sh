#!/usr/bin/env bash
#
# Deploy the ThinkPad ops-bot from this repo to the server and restart it.
#
# Reads DEPLOY_HOST / DEPLOY_PATH from .deploy.local (gitignored — keeps infra
# details off the public repo). Backs up the live copy before syncing, never
# overwrites the server's .env or runtime state, then restarts the PM2 process
# and prints status + recent logs so you can confirm it came back up.
#
# Usage:  ./deploy.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .deploy.local ]]; then
  echo "✗ .deploy.local not found." >&2
  echo "  Copy .deploy.local.example → .deploy.local and set DEPLOY_HOST / DEPLOY_PATH." >&2
  exit 1
fi
# shellcheck disable=SC1091
source .deploy.local
: "${DEPLOY_HOST:?set DEPLOY_HOST in .deploy.local}"
: "${DEPLOY_PATH:?set DEPLOY_PATH in .deploy.local}"

SSH_OPTS="-o ConnectTimeout=15 -o BatchMode=yes"
STAMP="$(date +%Y%m%d-%H%M%S)"

# Code-only backup: .env (secrets) and node_modules must never be copied
# into .bak dirs — old backups used to multiply token copies on disk.
echo "▶ Backing up live code → ${DEPLOY_PATH}.bak.${STAMP}"
ssh $SSH_OPTS "$DEPLOY_HOST" \
  "rsync -a --exclude '.env' --exclude 'node_modules' '${DEPLOY_PATH}/' '${DEPLOY_PATH}.bak.${STAMP}/' && \
   ls -dt '${DEPLOY_PATH}.bak.'* 2>/dev/null | tail -n +3 | xargs -r rm -rf"  # keep last 2 backups

echo "▶ Syncing source (secrets, deps, runtime state stay on the server)…"
rsync -az --delete \
  -e "ssh $SSH_OPTS" \
  --exclude '.env' \
  --exclude '.deploy.local' \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '*.log' \
  --exclude 'logs' \
  --exclude 'test/tmp' \
  --exclude 'crons.json' \
  --exclude 'todo.json' \
  --exclude 'context/crons.md' \
  --exclude 'context/machine.md' \
  ./ "${DEPLOY_HOST}:${DEPLOY_PATH}/"

echo "▶ Installing prod deps + restarting PM2…"
ssh $SSH_OPTS "$DEPLOY_HOST" \
  "cd '${DEPLOY_PATH}' && \
   (npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || true) && \
   pm2 restart tg-bot --update-env && \
   sleep 1 && pm2 list && \
   echo '--- recent logs ---' && \
   pm2 logs tg-bot --lines 8 --nostream 2>&1 | tail -12"

echo "✓ Deploy complete."
