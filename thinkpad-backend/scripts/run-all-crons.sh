#!/usr/bin/env bash
# One-button (re)registration of all ThinkPad crons in PM2.
# Deployed to the desktop as run_all_crons.sh by deploy.sh.
set -euo pipefail

cd "$HOME/manicbot-backend"
pm2 startOrReload ecosystem.config.js
pm2 save
pm2 ls
