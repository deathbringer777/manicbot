const { sh } = require("../tools/helpers.js");

module.exports = {
  commands: {
    "/run": {
      handler: async (chatId, arg) => {
        if (!arg) return "❌ Укажи имя скрипта: /run <name>\n\nПример: /run health-check";
        const config = require("../config.js");
        const { exec } = require("child_process");
        const { promisify } = require("util");
        const execAsync = promisify(exec);
        const out = await execAsync(`pm2 start ${arg} --attach`, { timeout: 60000, env: config.ENV })
          .then(r => (r.stdout + r.stderr).trim())
          .catch(e => `Ошибка: ${e.message.slice(0, 500)}`);
        return `▶️ Запуск "${arg}":\n${out}`;
      },
      description: "Запустить PM2 скрипт: /run health-check",
    },
  },
};
