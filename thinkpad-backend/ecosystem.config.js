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
      cron_restart: '*/30 * * * *',   // every 30 min (2× hourly)
      autorestart: false,
      watch: false,
    },
    {
      name: 'nightly',
      script: `${BASE}/crons/nightly.js`,
      cron_restart: '0 1,13 * * *',   // 01:00 + 13:00 — tenant sync + full D1 backup (2×/day)
      autorestart: false,
      watch: false,
    },
    {
      name: 'blog-autopilot',
      script: `${BASE}/crons/blog/autopilot.js`,
      cron_restart: '0 2,14 * * *',   // 02:00 + 14:00 — draft + TG approval (2×/day; gated by pending draft)
      autorestart: false,
      watch: false,
    },
    {
      name: 'gsc-monitor',
      script: `${BASE}/crons/gsc-monitor.js`,
      cron_restart: '0 8 * * *',      // 08:00 daily — Search Console 7d trend + index coverage → TG
      autorestart: false,             // no-ops cleanly until GSC_SERVICE_ACCOUNT_JSON is set
      watch: false,
    },
    {
      name: 'meta-ads-monitor',
      script: `${BASE}/crons/meta-ads-monitor.js`,
      cron_restart: '0 9 * * *',      // 09:00 daily — Meta ads spend/results 7d + Pixel health → TG
      autorestart: false,             // no-ops cleanly until META_ADS_TOKEN (ads_read) is set
      watch: false,
    },
    {
      name: 'lead-scout',
      script: `${BASE}/crons/lead-scout/index.js`,
      cron_restart: '*/15 * * * *',   // every 15 min slot rotation (4× hourly)
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
      cron_restart: '30 3,15 * * *',  // 03:30 + 15:30 — full crawl (2×/day), clear of nightly/blog
      autorestart: false,
      watch: false,
      env: {
        NODE_PATH: `${BASE}/node_modules`,
      },
    },
    {
      name: 'seo-geo-research',
      script: `${BASE}/crons/seo-geo/index.js`,
      cron_restart: '0 4 * * 1',      // Monday 04:00 — weekly deep SEO+GEO keyword research → report + Telegram
      autorestart: false,             // one-shot; collectors degrade cleanly if GSC/Trends are down
      watch: false,
    },
  ],
};
