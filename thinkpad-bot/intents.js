// Fast rule-based intent layer. Runs BEFORE the LLM so the most common spoken
// requests ("сделай скриншот", "включи lofi", "что играет", "громче") are
// instant, cost zero Groq tokens, and keep working even when Groq is rate-
// limited.
//
// NOTE: JS regex \b is ASCII-only — it does NOT mark a boundary next to Cyrillic
// letters, so we never rely on \b after Russian words. classify() is pure (no
// side effects) so the matching is unit-testable; tryIntent() executes it.
const music = require("./tools/music.js");
const screenshot = require("./tools/screenshot.js");
const kb = require("./keyboards.js");
const { esc } = require("./render.js");

const MUSIC_WORD = /музык|радио|ambient|эмбиент|эмбьент|лоф|lo-?fi|джаз|jazz|чил|chill|электрон|techno|техно|транс|house|хаус|news|новост|bbc|би-?би-?си|поток|станци|волну/;
const PLAY_VERB = /включи|поставь|вруб|играй|запусти|дай|послушать/;
const STOP_WORD = /выключи|выруб|останови|стоп|пауза|пауз|заглуши|хватит/;

// text → { kind, arg? } or null. Pure.
function classify(text) {
  const s = String(text || "").toLowerCase().trim();
  if (!s) return null;

  // Screenshot of the LOCAL screen. The explicit phrases always fire; a bare
  // «скрин/скриншот» fires only for a short request or with an imperative verb,
  // so a sentence ABOUT screenshots ("проанализируй эти скриншоты") falls
  // through to the LLM/vision path instead of snapping the bot's own screen.
  if (/что.{0,8}на экране|покажи экран|сфоткай экран|снимок экрана/.test(s)) {
    return { kind: "screenshot" };
  }
  if (/(^|[^а-яё])(скрин|скриншот|screenshot)/.test(s)) {
    const words = s.split(/\s+/).filter(Boolean).length;
    const hasShotVerb = /сделай|сними|дай|покажи|кинь|скинь|сфоткай|запили|нужен|хочу/.test(s);
    if (words <= 3 || hasShotVerb) return { kind: "screenshot" };
  }

  // now-playing first, so "что играет" beats the play/stop rules
  if (/что.{0,12}играет|какая.{0,10}(песня|музык|композици|станци)|что за (песня|трек|музык|композици)|что слушаю/.test(s)) {
    return { kind: "now_playing" };
  }

  if (STOP_WORD.test(s) && (MUSIC_WORD.test(s) || /пауза|пауз|заглуши|выруб|хватит/.test(s))) {
    return { kind: "music_stop" };
  }

  if (/следующ|переключи|друг(ую|ое)|смени|next/.test(s) && MUSIC_WORD.test(s)) {
    return { kind: "music_next" };
  }

  if (PLAY_VERB.test(s) && MUSIC_WORD.test(s)) {
    return { kind: "music_play", arg: s };
  }

  const m = s.match(/громкость\s*(?:на\s*)?(\d{1,3})/);
  if (m) return { kind: "volume_set", arg: parseInt(m[1], 10) };
  if (/громче|погромче|прибав/.test(s)) return { kind: "volume_up" };
  if (/тише|потише|убав/.test(s)) return { kind: "volume_down" };

  return null;
}

async function tryIntent(text) {
  const intent = classify(text);
  if (!intent) return null;

  switch (intent.kind) {
    case "screenshot": {
      const r = await screenshot.captureFullScreen();
      return r.ok ? { photo: r.path, caption: "📸 экран" } : { text: esc(r.error) };
    }
    case "now_playing": {
      const r = await music.nowPlaying();
      return r.playing
        ? { text: `🎶 <b>${esc(r.title)}</b>`, keyboard: kb.musicTransport() }
        : { text: "⏹ Ничего не играет" };
    }
    case "music_stop":
      await music.stop();
      return { text: "⏹ Музыка остановлена" };
    case "music_next": {
      const r = await music.next();
      return { text: `⏭ <b>${esc(r.title)}</b>`, keyboard: kb.musicTransport() };
    }
    case "music_play": {
      const r = await music.playQuery(intent.arg);
      return { text: `🎵 Играю: <b>${esc(r.title)}</b>`, keyboard: kb.musicTransport() };
    }
    case "volume_set": {
      const r = await music.setVolume(intent.arg);
      return { text: `🔊 Громкость: ${r.pct}%` };
    }
    case "volume_up":
      await music.volumeUp();
      return { text: "🔊 Громче" };
    case "volume_down":
      await music.volumeDown();
      return { text: "🔉 Тише" };
    default:
      return null;
  }
}

module.exports = { classify, tryIntent, MUSIC_WORD };
