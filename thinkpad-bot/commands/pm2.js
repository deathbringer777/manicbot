const config = require("../config.js");

async function pm2Exec(action, name) {
  const { exec } = require("child_process");
  const { promisify } = require("util");
  const execAsync = promisify(exec);
  return execAsync(`pm2 ${action} ${name}`, { env: config.ENV })
    .then(r => (r.stdout + r.stderr).trim())
    .catch(e => `Ошибка: ${e.message}`);
}

module.exports = {
  commands: {
    "/logs": {
      handler: async (chatId, arg) => {
        const name = arg || "tg-bot";
        const tg = require("../telegram.js");
        const stopTyping = tg.keepTyping(chatId);
        const out = await pm2Exec(`logs ${name} --lines 40 --nostream 2>&1`, "");
        stopTyping();
        return `📜 Логи ${name}:\n${out}`;
      },
      description: "Логи PM2-процесса: /logs booksy-full",
    },
    "/start_proc": {
      handler: async (chatId, arg) => {
        if (!arg) return "Укажи имя: /start_proc <name>";
        const out = await pm2Exec("start", arg);
        return `▶️ start ${arg}:\n${out}`;
      },
      description: "Запустить процесс PM2: /start_proc nightly",
    },
    "/stop_proc": {
      handler: async (chatId, arg) => {
        if (!arg) return "Укажи имя: /stop_proc <name>";
        const out = await pm2Exec("stop", arg);
        return `⏹ stop ${arg}:\n${out}`;
      },
      description: "Остановить процесс PM2: /stop_proc nightly",
    },
    "/restart_proc": {
      handler: async (chatId, arg) => {
        if (!arg) return "Укажи имя: /restart_proc <name>";
        const out = await pm2Exec("restart", arg);
        return `🔄 restart ${arg}:\n${out}`;
      },
      description: "Перезапустить процесс PM2: /restart_proc tg-bot",
    },
  },
};
