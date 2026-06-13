module.exports = {
  apps: [
    {
      name: "tg-bot",
      script: "/home/kirill/automation/tg-bot/bot.js",
      cwd: "/home/kirill/automation/tg-bot",
      interpreter: "node",
      autorestart: true,
      watch: false,
      // Transient DNS (EAI_AGAIN) / Groq rate-limits are caught in-process; a
      // genuine boot-crash should retry generously with exponential backoff rather
      // than give up after 10 (which would silently leave the operator with no bot).
      exp_backoff_restart_delay: 500,
      max_restarts: 50,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
