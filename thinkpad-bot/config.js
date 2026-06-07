require("dotenv").config();

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
  GROQ_MODEL: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  ALLOWED_USER_ID,
  CHAT_ID: (() => {
    const raw = process.env.CHAT_ID || process.env.ALLOWED_USER_ID;
    const n = parseInt(raw, 10);
    return isNaN(n) ? ALLOWED_USER_ID : n;
  })(),
  POLL_TIMEOUT: 30,
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.2,
  GROQ_BASE_URL: "https://api.groq.com/openai/v1/chat/completions",
  TG_API_BASE: `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`,
  BOT_DIR: __dirname,
  CONTEXT_DIR: __dirname + "/context",
  CRONS_FILE: __dirname + "/crons.json",
  ENV: {
    ...process.env,
    DISPLAY: ":0",
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || "unix:path=/run/user/1000/bus",
    HOME: process.env.HOME || "/home/kirill",
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || "/run/user/1000",
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || "wayland-0",
  },
};

module.exports = config;
