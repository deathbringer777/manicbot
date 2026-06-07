module.exports = {
  apps: [
    {
      name: "tg-bot",
      script: "/home/kirill/automation/tg-bot/bot.js",
      cwd: "/home/kirill/automation/tg-bot",
      interpreter: "node",
      autorestart: true,
      watch: false,
      restart_delay: 5000,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
