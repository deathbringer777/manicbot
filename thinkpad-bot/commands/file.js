const { sh, fs } = require("../tools/helpers.js");
const render = require("../render.js");

const { esc, block } = render;

async function sendDocument(chatId, filePath, caption) {
  const { exec } = require("child_process");
  const { promisify } = require("util");
  const execAsync = promisify(exec);
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendDocument`;
  const capArg = caption ? ` -F "caption=${caption}"` : "";
  const cmd = `curl -s -X POST "${url}" -F "chat_id=${chatId}" -F "document=@${filePath}"${capArg}`;
  const { stdout } = await execAsync(cmd, { timeout: 120000 });
  return JSON.parse(stdout || "{}");
}

module.exports = {
  commands: {
    "/upload": {
      handler: async (chatId, arg) => {
        if (!arg) return { text: "Укажи путь: <code>/upload ~/report.pdf</code>" };
        const filePath = arg.replace(/^~/, process.env.HOME || "/home/kirill");
        if (!fs.existsSync(filePath)) return { text: `❌ Файл не найден: <code>${esc(filePath)}</code>` };
        const stat = fs.statSync(filePath);
        if (stat.size > 50 * 1024 * 1024) {
          return { text: `❌ Файл слишком большой (${Math.round(stat.size / 1048576)}MB). Максимум 50MB.` };
        }
        const result = await sendDocument(chatId, filePath);
        return {
          text: result.ok
            ? `📎 Файл отправлен: ${esc(arg)} (${Math.round((stat.size / 1048576) * 10) / 10}MB)`
            : `❌ Ошибка отправки: ${esc(result.description || "неизвестная")}`,
        };
      },
      description: "Загрузить файл: /upload /path/to/file",
    },

    "/find": {
      handler: async (chatId, arg) => {
        if (!arg) return { text: "Укажи имя файла: <code>/find *.log</code>" };
        const out = await sh(`find /home/kirill -maxdepth 5 -iname '${arg}' -type f 2>/dev/null | head -20`);
        const lines = out.split("\n").filter(Boolean);
        if (!lines.length || out.startsWith("Ошибка")) return { text: `🔍 Файлы «${esc(arg)}» не найдены` };
        return { text: block(lines.join("\n"), { title: `🔍 Найдено «${arg}»: ${lines.length}`, maxLines: 20 }) };
      },
      description: "Поиск файла: /find *.log",
    },

    "/backup": {
      handler: async (chatId, arg) => {
        if (!arg) return { text: "Укажи путь: <code>/backup ~/manicbot-backend/data.db</code>" };
        const src = arg.replace(/^~/, process.env.HOME || "/home/kirill");
        if (!fs.existsSync(src)) return { text: `❌ Путь не найден: <code>${esc(src)}</code>` };
        const name = require("path").basename(src);
        const backupPath = `/tmp/backup_${name}_${Date.now()}.tar.gz`;
        const out = await sh(`tar -czf "${backupPath}" -C "$(dirname "${src}")" "${name}" 2>&1`);
        if (out.startsWith("Ошибка") || !fs.existsSync(backupPath)) return { text: `❌ Ошибка бэкапа: ${esc(out)}` };
        const size = fs.statSync(backupPath).size;
        const result = await sendDocument(chatId, backupPath, `💾 Бэкап: ${name}`);
        try { fs.unlinkSync(backupPath); } catch { /* ignore */ }
        return {
          text: result.ok
            ? `💾 Бэкап ${esc(name)} отправлен (${Math.round((size / 1048576) * 10) / 10}MB)`
            : `❌ Ошибка отправки: ${esc(result.description || "неизвестная")}`,
        };
      },
      description: "Создать бэкап: /backup /path/to/file_or_dir",
    },
  },
};
