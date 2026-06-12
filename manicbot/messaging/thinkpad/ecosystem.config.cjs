/**
 * PM2 process definitions for the ManicBot messaging ThinkPad tier.
 * Each entry is a cron-scheduled one-shot (autorestart:false) — PM2 runs it on
 * the schedule, it exits, PM2 records the run. Logs go to ~/automation/logs/.
 *
 * Apply:  pm2 start ecosystem.config.cjs && pm2 save
 */
const path = require('path');
const HERE = __dirname;
const LOGS = path.join(process.env.HOME || '/home/kirill', 'automation', 'logs');

const base = {
  cwd: HERE,
  autorestart: false,
  instances: 1,
  exec_mode: 'fork',
  // Node 22 native dotenv — load ./.env (WORKER_URL, MESSAGING_TOKEN) without a
  // dotenv dependency. PM2 passes these before the script name.
  node_args: '--env-file=.env',
  out_file: path.join(LOGS, 'messaging.log'),
  error_file: path.join(LOGS, 'messaging.err.log'),
  time: true,
};

module.exports = {
  apps: [
    // Daily 06:00 — refresh the holiday calendar (this year + next).
    { ...base, name: 'msg-holidays-sync', script: 'holidays-sync.js', cron_restart: '0 6 * * *' },
    // Daily 06:30 — schedule upcoming-occasion draft campaigns.
    { ...base, name: 'msg-content-plan', script: 'content-plan-builder.js', cron_restart: '30 6 * * *' },
    // Weekly Mon 05:00 — regenerate the seasonal preset library (Claude Sonnet).
    { ...base, name: 'msg-preset-gen', script: 'preset-generator.js', cron_restart: '0 5 * * 1' },
    // Hourly — draft-count health line for the tg-bot + monitoring.
    { ...base, name: 'msg-health', script: 'health-report.js', cron_restart: '15 * * * *' },
  ],
};
