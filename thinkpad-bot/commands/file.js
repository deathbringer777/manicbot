const { sh, fs } = require("../tools/helpers.js");

module.exports = {
  commands: {
    "/upload": {
      handler: async (chatId, arg) => {
        if (!arg) return "❌ Укажи путь: /upload <path>\n\nПример: /upload ~/report.pdf";
        const filePath = arg.replace(/^~/, process.env.HOME || "/home/kirill");
        if (!fs.existsSync(filePath)) return `❌ Файл не найден: ${filePath}`;
        const stat = fs.statSync(filePath);
        if (stat.size > 50 * 1024 * 1024) return `❌ Файл слишком большой (${Math.round(stat.size / 1024 / 1024)}MB). Максимум 50MB.`;
        const tg = require("../telegram.js");
        const { exec } = require("child_process");
        const { promisify } = require("util");
        const execAsync = promisify(exec);
        const apiToken = process.env.TELEGRAM_TOKEN;
        const url = `https://api.telegram.org/bot${apiToken}/sendDocument`;
        const cmd = `curl -s -X POST "${url}" -F "chat_id=${chatId}" -F "document=@${filePath}"`;
        const out = await execAsync(cmd, { timeout: 60000 });
        const result = JSON.parse(out.stdout || "{}");
        if (result.ok) return `📎 Файл отправлен: ${arg} (${Math.round(stat.size / 1024 / 1024 * 10) / 10}MB)`;
        return `❌ Ошибка отправки: ${result.description || "неизвестная"}`;
      },
      description: "Загрузить файл: /upload /path/to/file",
    },

    "/find": {
      handler: async (chatId, arg) => {
        if (!arg) return "❌ Укажи имя файла: /find <name>\n\nПример: /find *.log";
        const out = await sh(`find /home/kirill -maxdepth 5 -iname '${arg}' -type f 2>/dev/null | head -20`);
        if (!out.trim() || out.startsWith("Ошибка")) return `🔍 Файлы "${arg}" не найдены`;
        const lines = out.split("\n").filter(Boolean);
        return `🔍 Найдено файлов "${arg}": ${lines.length}\n${lines.map(l => `  📄 ${l}`).join("\n")}`;
      },
      description: "Поиск файла: /find *.log",
    },

    "/backup": {
      handler: async (chatId, arg) => {
        if (!arg) return "❌ Укажи путь: /backup <path>\n\nПример: /backup ~/manicbot-backend/data.db";
        const src = arg.replace(/^~/, process.env.HOME || "/home/kirill");
        if (!fs.existsSync(src)) return `❌ Путь не найден: ${src}`;
        const name = require("path").basename(src);
        const backupPath = `/tmp/backup_${name}_${Date.now()}.tar.gz`;
        const out = await sh(`tar -czf "${backupPath}" -C "$(dirname "${src}")" "${name}" 2>&1`);
        if (out.startsWith("Ошибка") || !fs.existsSync(backupPath)) return `❌ Ошибка бэкапа: ${out}`;
        const size = fs.statSync(backupPath).size;
        const tg = require("../telegram.js");
        const apiToken = process.env.TELEGRAM_TOKEN;
        const url = `https://api.telegram.org/bot${apiToken}/sendDocument`;
        const { exec } = require("child_process");
        const { promisify } = require("util");
        const execAsync = promisify(exec);
        const cmd = `curl -s -X POST "${url}" -F "chat_id=${chatId}" -F "document=@${backupPath}" -F "caption=💾 Бэкап: ${name}"`;
        const result = JSON.parse((await execAsync(cmd, { timeout: 120000 })).stdout || "{}");
        try { fs.unlinkSync(backupPath); } catch {}
        if (result.ok) return `💾 Бэкап ${name} отправлен (${Math.round(size / 1024 / 1024 * 10) / 10}MB)`;
        return `❌ Ошибка отправки: ${result.description || "неизвестная"}`;
      },
      description: "Создать бэкап: /backup /path/to/file_or_dir",
    },
  },
};
