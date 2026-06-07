const { sh, fs } = require("../tools/helpers.js");

module.exports = {
  commands: {
    "/voice": {
      handler: async (chatId, arg) => {
        const duration = parseInt(arg, 10) || 5;
        if (duration < 1 || duration > 30) return "❌ Длительность от 1 до 30 секунд";
        const path = `/tmp/voice_${Date.now()}.ogg`;
        const out = await sh(`arecord -d ${duration} -f cd -t wav - 2>/dev/null | ffmpeg -i pipe: -c:a libopus "${path}" -y 2>&1 || echo 'Ошибка'`);
        if (out.includes("Ошибка") || !fs.existsSync(path)) {
          return "❌ Микрофон не найден";
        }
        const size = fs.statSync(path).size;
        const tg = require("../telegram.js");
        const { exec } = require("child_process");
        const { promisify } = require("util");
        const execAsync = promisify(exec);
        const apiToken = process.env.TELEGRAM_TOKEN;
        const url = `https://api.telegram.org/bot${apiToken}/sendVoice`;
        const cmd = `curl -s -X POST "${url}" -F "chat_id=${chatId}" -F "voice=@${path}"`;
        const result = JSON.parse((await execAsync(cmd, { timeout: 30000 })).stdout || "{}");
        try { fs.unlinkSync(path); } catch {}
        if (result.ok) return `🎤 Голосовое сообщение (${duration}с, ${Math.round(size / 1024)}KB) отправлено`;
        return `❌ Ошибка: ${result.description || "неизвестная"}`;
      },
      description: "Голосовое сообщение: /voice [секунд]",
    },
  },
};
