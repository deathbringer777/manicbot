const { sh } = require("../tools/helpers.js");

module.exports = {
  commands: {
    "/browser": {
      handler: async (chatId, arg) => {
        if (!arg) return "❌ Укажи URL: /browser <url>\n\nПример: /browser https://example.com";
        const url = arg.startsWith("http") ? arg : `https://${arg}`;
        const { exec } = require("child_process");
        const { promisify } = require("util");
        const execAsync = promisify(exec);
        const outPath = `/tmp/browser_${Date.now()}.png`;
        try {
          await execAsync(
            `node ${__dirname}/../browser/screenshot.js '${url.replace(/'/g, "'\\''")}'`,
            { timeout: 30000 }
          );
          const fs = require("fs");
          if (!fs.existsSync("/tmp/screenshot.png")) return "❌ Не удалось сделать скриншот страницы";
          fs.renameSync("/tmp/screenshot.png", outPath);
          const size = fs.statSync(outPath).size;
          const tg = require("../telegram.js");
          await tg.sendPhoto(chatId, outPath, `📸 ${url}\n${Math.round(size / 1024)}KB`);
          try { fs.unlinkSync(outPath); } catch {}
          return null;
        } catch (e) {
          return `❌ Ошибка: ${e.message}`;
        }
      },
      description: "Скриншот веб-страницы: /browser https://...",
    },
  },
};
