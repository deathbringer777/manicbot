const screenshot = require("../tools/screenshot.js");
const { sh } = require("../tools/helpers.js");

let monitorInterval = null;

module.exports = {
  commands: {
    "/monitor": {
      handler: async (chatId, arg) => {
        const tg = require("../telegram.js");
        const parts = (arg || "").split(/\s+/);
        const action = parts[0]?.toLowerCase();

        if (action === "off" || action === "stop") {
          if (monitorInterval) {
            clearInterval(monitorInterval);
            monitorInterval = null;
            return "⏹ Мониторинг остановлен";
          }
          return "ℹ️ Мониторинг не запущен";
        }

        const intervalSec = parseInt(parts[0], 10) || 30;
        if (intervalSec < 10) return "❌ Минимальный интервал — 10 секунд";

        if (monitorInterval) {
          clearInterval(monitorInterval);
          monitorInterval = null;
        }

        // Send first screenshot immediately
        const r = await screenshot.captureFullScreen();
        if (r.ok) {
          await tg.sendPhoto(chatId, r.path, `📸 Мониторинг запущен (каждые ${intervalSec}с)`);
        }

        monitorInterval = setInterval(async () => {
          const r2 = await screenshot.captureFullScreen();
          if (r2.ok) {
            await tg.sendPhoto(chatId, r2.path, `📸 ${new Date().toLocaleString("ru-RU")}`);
          }
        }, intervalSec * 1000);

        return `📸 Мониторинг запущен. Интервал: ${intervalSec}с\nОстановить: /monitor off`;
      },
      description: "Режим мониторинга: /monitor [interval_sec] или off",
    },
  },
};
