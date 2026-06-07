// Internet-radio player for the bot. Engine: ffplay (ships with ffmpeg, already
// installed — no sudo needed, unlike mpv). ffplay reliably streams Icecast/MP3
// where Rhythmbox's CLI does not. Playback is a detached process we start/stop;
// system volume is driven via wpctl (PipeWire). Current station is persisted to
// a small state file so /np survives a bot restart.
const { spawn } = require("child_process");
const fs = require("fs");
const { sh } = require("./helpers.js");
const config = require("../config.js");

const STATE_FILE = "/tmp/mb-music.json";

const PRESETS = {
  ambient: { title: "Ambient · SomaFM Drone Zone", url: "https://ice1.somafm.com/dronezone-128-mp3" },
  lofi: { title: "Lo-Fi / Chill · SomaFM Groove Salad", url: "https://ice1.somafm.com/groovesalad-128-mp3" },
  chill: { title: "Chill · SomaFM Groove Salad", url: "https://ice1.somafm.com/groovesalad-128-mp3" },
  jazz: { title: "Jazz · SomaFM Sonic Universe", url: "https://ice1.somafm.com/sonicuniverse-128-mp3" },
  electronic: { title: "Electronic · SomaFM Space Station", url: "https://ice1.somafm.com/spacestation-128-mp3" },
  focus: { title: "Focus · SomaFM Drone Zone", url: "https://ice1.somafm.com/dronezone-128-mp3" },
  news: { title: "BBC World Service", url: "https://stream.live.vc.bbcmedia.co.uk/bbc_world_service" },
  radio: { title: "SomaFM Groove Salad", url: "https://ice1.somafm.com/groovesalad-128-mp3" },
};
const PRESET_ORDER = ["lofi", "ambient", "jazz", "electronic", "news"];

const PRESET_NAMES = Object.keys(PRESETS);

// Map a free-text request to a preset key (used by /play and the intent layer).
function aliasToPreset(q) {
  const s = String(q || "").toLowerCase().trim();
  if (!s) return null;
  if (PRESETS[s]) return s;
  if (/эмбиент|эмбьент|ambient|дрон|drone/.test(s)) return "ambient";
  if (/лоф|lo-?fi|чил|chill/.test(s)) return "lofi";
  if (/джаз|jazz/.test(s)) return "jazz";
  if (/электрон|electro|техно|techno|транс|trance|house|хаус/.test(s)) return "electronic";
  if (/новост|news|би-?би-?си|bbc/.test(s)) return "news";
  if (/фокус|focus|концентрац/.test(s)) return "focus";
  if (/радио|radio|музык|music|поток|stream/.test(s)) return "radio";
  return null;
}

function saveState(state) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch { /* ignore */ }
}
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return null; }
}

async function isPlaying() {
  const out = await sh("pgrep -x ffplay >/dev/null && echo yes || echo no", 4000);
  return out.trim() === "yes";
}

async function ensureAudible(volPct) {
  await sh("wpctl set-mute @DEFAULT_AUDIO_SINK@ 0", 4000);
  if (volPct != null) {
    const v = Math.max(0, Math.min(100, volPct)) / 100;
    await sh(`wpctl set-volume @DEFAULT_AUDIO_SINK@ ${v}`, 4000);
  }
}

async function stop() {
  await sh("pkill -x ffplay 2>/dev/null; true", 4000);
  saveState(null);
  return { ok: true };
}

async function playPreset(name) {
  const key = PRESETS[name] ? name : "radio";
  const p = PRESETS[key];
  await sh("pkill -x ffplay 2>/dev/null; true", 4000); // one stream at a time
  await ensureAudible(40);
  const child = spawn(
    "ffplay",
    ["-nodisp", "-loglevel", "quiet", "-infbuf", p.url],
    { detached: true, stdio: "ignore", env: config.ENV },
  );
  child.unref();
  saveState({ preset: key, title: p.title, startedAt: Date.now() });
  return { ok: true, preset: key, title: p.title };
}

// Free-text "включи X" → best preset (defaults to radio).
async function playQuery(q) {
  return playPreset(aliasToPreset(q) || "radio");
}

async function pause() {
  // Radio can't truly pause; stopping is the honest behaviour.
  return stop();
}

async function resume() {
  const s = loadState();
  if (s?.preset) return playPreset(s.preset);
  return playPreset("radio");
}

async function toggle() {
  return (await isPlaying()) ? stop() : resume();
}

async function next() {
  const s = loadState();
  const idx = s?.preset ? PRESET_ORDER.indexOf(s.preset) : -1;
  const nextKey = PRESET_ORDER[(idx + 1) % PRESET_ORDER.length];
  return playPreset(nextKey);
}

async function nowPlaying() {
  if (!(await isPlaying())) return { ok: true, playing: false, title: "ничего не играет" };
  const s = loadState();
  return { ok: true, playing: true, title: s?.title || "радио" };
}

async function setVolume(pct) {
  await ensureAudible(pct);
  return { ok: true, pct: Math.max(0, Math.min(100, Math.round(pct))) };
}
async function volumeUp() {
  await sh("wpctl set-mute @DEFAULT_AUDIO_SINK@ 0 && wpctl set-volume @DEFAULT_AUDIO_SINK@ 10%+", 4000);
  return { ok: true };
}
async function volumeDown() {
  await sh("wpctl set-volume @DEFAULT_AUDIO_SINK@ 10%-", 4000);
  return { ok: true };
}

// Inline transport buttons (mus:*) — wired from callbacks.js.
async function handleCallback(cq) {
  const tg = require("../telegram.js");
  const kb = require("../keyboards.js");
  const action = (cq.data || "").split(":")[1];
  const map = {
    toggle: toggle, next: next, prev: next, stop: stop,
    volup: volumeUp, voldown: volumeDown, np: nowPlaying,
  };
  const fn = map[action];
  if (!fn) return tg.answerCallbackQuery(cq.id, "—");
  await fn();
  await tg.answerCallbackQuery(cq.id, "ок");
  const np = await nowPlaying();
  const text = np.playing ? `🎶 <b>${np.title}</b>` : "⏹ Музыка остановлена";
  return tg.editMessageText(cq.message.chat.id, cq.message.message_id, text, {
    reply_markup: kb.musicTransport(),
  });
}

module.exports = {
  PRESETS,
  PRESET_NAMES,
  aliasToPreset,
  isPlaying,
  playPreset,
  playQuery,
  pause,
  resume,
  toggle,
  next,
  stop,
  nowPlaying,
  setVolume,
  volumeUp,
  volumeDown,
  handleCallback,
};
