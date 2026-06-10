require('dotenv').config({ path: require('path').join(__dirname, '.env') });

module.exports = {
  apps: [
    {
      name: 'health-check',
      script: '/home/kirill/manicbot-backend/crons/health-check.js',
      cron_restart: '0 * * * *',   // каждый час
      autorestart: false,
      watch: false,
      env_file: '.env',
    },
    {
      name: 'nightly',
      script: '/home/kirill/manicbot-backend/crons/nightly.js',
      cron_restart: '0 1 * * *',   // каждый день в 01:00
      autorestart: false,
      watch: false,
      env_file: '.env',
    },
    {
      name: 'lead-scout',
      script: '/home/kirill/manicbot-backend/crons/lead-scout/index.js',
      cron_restart: '0 * * * *',   // каждый час
      autorestart: false,
      watch: false,
      env_file: '.env',
      env: {
        // Explicit node_modules path so playwright resolves in any PM2 environment.
        // Without this, a process started by systemd at boot (before npm ci) may
        // fail to find playwright even though it's installed in the project root.
        NODE_PATH: '/home/kirill/manicbot-backend/node_modules',
      },
    },
    {
      name: 'booksy-full',
      script: '/home/kirill/manicbot-backend/crons/lead-scout/booksy-full.js',
      cron_restart: '30 3 * * *',  // 03:30 ночи — не пересекается с nightly (01:00)
      autorestart: false,
      watch: false,
      env_file: '.env',
      env: {
        NODE_PATH: '/home/kirill/manicbot-backend/node_modules',
      },
    },
    {
      name: 'blog-autopilot',
      script: '/home/kirill/manicbot-backend/crons/blog-autopilot.js',
      cron_restart: '0 2 * * *',   // каждый день в 02:00
      autorestart: false,
      watch: false,
      env_file: '.env',
    },
    {
      name: 'reels-parser',
      script: '/home/kirill/manicbot-backend/crons/reels-parser/index.js',
      cron_restart: '0 */3 * * *',  // каждые 3 часа — копит рилзы порциями
      autorestart: false,
      watch: false,
      env_file: '.env',
      env: {
        NODE_PATH: '/home/kirill/manicbot-backend/node_modules',
      },
    },
  ],
};
