const config = require("../config.js");
const render = require("../render.js");

async function pm2Exec(action, name) {
  const { exec } = require("child_process");
  const { promisify } = require("util");
  const execAsync = promisify(exec);
  return execAsync(`pm2 ${action} ${name}`, { env: config.ENV })
    .then((r) => (r.stdout + r.stderr).trim())
    .catch((e) => `Ошибка: ${e.message}`);
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
        const cleaned = out
          .split("\n")
          .map((l) => l.replace(/^\d+\|[\w-]+\s*\|\s?/, ""))
          .filter((l) => l.trim())
          .join("\n");
        return { text: render.block(cleaned, { title: `📜 Логи ${name}`, maxLines: 40 }) };
      },
      description: "Логи PM2-процесса: /logs booksy-full",
    },
    "/start_proc": {
      handler: async (chatId, arg) => {
        if (!arg) return { text: "Укажи имя: <code>/start_proc nightly</code>" };
        const out = await pm2Exec("start", arg);
        return { text: render.block(out, { title: `▶️ start ${arg}`, maxLines: 8 }) };
      },
      description: "Запустить процесс PM2: /start_proc nightly",
    },
    "/stop_proc": {
      handler: async (chatId, arg) => {
        if (!arg) return { text: "Укажи имя: <code>/stop_proc nightly</code>" };
        const out = await pm2Exec("stop", arg);
        return { text: render.block(out, { title: `⏹ stop ${arg}`, maxLines: 8 }) };
      },
      description: "Остановить процесс PM2: /stop_proc nightly",
    },
    "/restart_proc": {
      handler: async (chatId, arg) => {
        if (!arg) return { text: "Укажи имя: <code>/restart_proc tg-bot</code>" };
        const out = await pm2Exec("restart", arg);
        return { text: render.block(out, { title: `🔄 restart ${arg}`, maxLines: 8 }) };
      },
      description: "Перезапустить процесс PM2: /restart_proc tg-bot",
    },
  },
};
