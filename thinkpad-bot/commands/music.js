const music = require("../tools/music.js");
const kb = require("../keyboards.js");
const { esc } = require("../render.js");

module.exports = {
  commands: {
    "/play": {
      handler: async (chatId, arg) => {
        const r = await music.playQuery(arg || "radio");
        return { text: `🎵 Играю: <b>${esc(r.title)}</b>`, keyboard: kb.musicTransport() };
      },
      description: "Музыка/радио: /play ambient | lofi | jazz | news",
    },
    "/pause": {
      handler: async () => { await music.pause(); return { text: "⏹ Музыка остановлена" }; },
      description: "Остановить музыку",
    },
    "/stop": {
      handler: async () => { await music.stop(); return { text: "⏹ Музыка остановлена" }; },
      description: "Остановить музыку",
    },
    "/np": {
      handler: async () => {
        const r = await music.nowPlaying();
        return r.playing
          ? { text: `🎶 <b>${esc(r.title)}</b>`, keyboard: kb.musicTransport() }
          : { text: "⏹ Ничего не играет" };
      },
      description: "Что сейчас играет",
    },
    "/vol": {
      handler: async (chatId, arg) => {
        const n = parseInt(arg, 10);
        if (Number.isNaN(n)) return { text: "🔊 Громкость 0–100: <code>/vol 40</code>" };
        const r = await music.setVolume(n);
        return { text: `🔊 Громкость: ${r.pct}%` };
      },
      description: "Громкость 0–100: /vol 40",
    },
  },
};
