require("dotenv").config({ quiet: true });

// GROQ_KEY stays required: voice notes are transcribed by Groq Whisper
// (Claude has no speech-to-text). All TEXT generation goes through the
// claude CLI on the Max subscription — see llm.js.
const required = ["TELEGRAM_TOKEN", "GROQ_KEY", "ALLOWED_USER_ID"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} is required in .env`);
}

const ALLOWED_USER_ID = (() => {
  const n = parseInt(process.env.ALLOWED_USER_ID, 10);
  if (isNaN(n)) throw new Error("ALLOWED_USER_ID must be a valid number");
  return n;
})();

const config = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
  GROQ_KEY: process.env.GROQ_KEY,
  WHISPER_MODEL: process.env.WHISPER_MODEL || "whisper-large-v3-turbo",
  ALLOWED_USER_ID,
  CHAT_ID: (() => {
    const raw = process.env.CHAT_ID || process.env.ALLOWED_USER_ID;
    const n = parseInt(raw, 10);
    return isNaN(n) ? ALLOWED_USER_ID : n;
  })(),
  POLL_TIMEOUT: 30,

  // Claude Code CLI (Max subscription; OAuth creds live in ~/.claude)
  CLAUDE_BIN: process.env.CLAUDE_BIN || "claude",
  CLAUDE_MODEL: process.env.CLAUDE_MODEL || "sonnet",
  CLAUDE_EFFORT: process.env.CLAUDE_EFFORT || "medium",
  CLAUDE_TIMEOUT_MS: parseInt(process.env.CLAUDE_TIMEOUT_MS || "300000", 10),
  CLAUDE_SESSIONS_FILE: process.env.CLAUDE_SESSIONS_FILE || "/tmp/tg-bot-claude-sessions.json",
  // Explicit tool allowlist for the headless claude agent (permission system
  // stays on; everything not listed is denied in -p mode).
  CLAUDE_ALLOWED_TOOLS: process.env.CLAUDE_ALLOWED_TOOLS || "Bash,Read,Glob,Grep,Edit,Write",

  TG_API_BASE: `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`,
  BOT_DIR: __dirname,
  CONTEXT_DIR: __dirname + "/context",
  CRONS_FILE: __dirname + "/crons.json",
  // Graphical-session env injected into every child process so GUI tools
  // (ydotool, wtype, gdbus, rhythmbox-client) reach the live Wayland session.
  // Verified on the target box: GNOME 50 / Wayland, uid 1000, WAYLAND_DISPLAY=wayland-0.
  ENV: (() => {
    const xdgRuntime = process.env.XDG_RUNTIME_DIR || "/run/user/1000";
    return {
      ...process.env,
      DISPLAY: process.env.DISPLAY || ":0",
      DBUS_SESSION_BUS_ADDRESS:
        process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=${xdgRuntime}/bus`,
      HOME: process.env.HOME || "/home/kirill",
      XDG_RUNTIME_DIR: xdgRuntime,
      WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || "wayland-0",
      // ydotool talks to ydotoold over this socket; without it input silently no-ops.
      YDOTOOL_SOCKET: process.env.YDOTOOL_SOCKET || `${xdgRuntime}/.ydotool_socket`,
    };
  })(),
};

module.exports = config;
