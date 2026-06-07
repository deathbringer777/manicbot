const render = require("../render.js");

module.exports = {
  commands: {
    "/run": {
      handler: async (chatId, arg) => {
        if (!arg) return { text: "Укажи имя скрипта: <code>/run health-check</code>" };
        const config = require("../config.js");
        const { exec } = require("child_process");
        const { promisify } = require("util");
        const execAsync = promisify(exec);
        const out = await execAsync(`pm2 start ${arg} --attach`, { timeout: 60000, env: config.ENV })
          .then((r) => (r.stdout + r.stderr).trim())
          .catch((e) => `Ошибка: ${e.message.slice(0, 500)}`);
        return { text: render.block(out, { title: `▶️ Запуск ${arg}`, maxLines: 30 }) };
      },
      description: "Запустить PM2 скрипт: /run health-check",
    },
  },
};
