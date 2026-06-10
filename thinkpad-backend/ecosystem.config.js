/**
 * PM2 process map for the ThinkPad sidecar crons.
 *
 * Every app is a one-shot script revived on its cron_restart schedule
 * (autorestart: false — a crashed run must not loop; failures alert to
 * Telegram via lib/runner instead). Each cron loads ~/manicbot-backend/.env
 * itself via dotenv — no env wiring here.
 *
 * After editing: pm2 startOrReload ecosystem.config.js && pm2 save
 */
const HOME = '/home/kirill';
const BASE = `${HOME}/manicbot-backend`;

module.exports = {
  apps: [
    {
      name: 'health-check',
      script: `${BASE}/crons/health-check.js`,
      cron_restart: '0 * * * *',   // hourly
      autorestart: false,
      watch: false,
    },
    {
      name: 'nightly',
      script: `${BASE}/crons/nightly.js`,
      cron_restart: '0 1 * * *',   // 01:00 — tenant sync + full D1 backup
      autorestart: false,
      watch: false,
    },
    {
      name: 'blog-autopilot',
      script: `${BASE}/crons/blog/autopilot.js`,
      cron_restart: '0 2 * * *',   // 02:00 — draft + TG approval buttons
      autorestart: false,
      watch: false,
    },
    {
      name: 'lead-scout',
      script: `${BASE}/crons/lead-scout/index.js`,
      cron_restart: '0 * * * *',   // hourly slot rotation
      autorestart: false,
      watch: false,
      env: {
        // Explicit node_modules path so playwright resolves in any PM2
        // environment (systemd boot starts PM2 before any shell profile).
        NODE_PATH: `${BASE}/node_modules`,
      },
    },
    {
      name: 'booksy-full',
      script: `${BASE}/crons/lead-scout/booksy-full.js`,
      cron_restart: '30 3 * * *',  // 03:30 — keeps clear of nightly (01:00) and blog (02:00)
      autorestart: false,
      watch: false,
      env: {
        NODE_PATH: `${BASE}/node_modules`,
      },
    },
  ],
};
