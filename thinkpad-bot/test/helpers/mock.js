const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

const TOOL_MODULES = [
  "tools/helpers.js",
  "tools/clipboard.js",
  "tools/keyboard.js",
  "tools/mouse.js",
  "tools/screenshot.js",
  "tools/window.js",
  "tools.js",
  "commands.js",
];

function clearToolCache() {
  for (const mod of TOOL_MODULES) {
    delete require.cache[path.join(ROOT, mod)];
  }
}

function setTestEnv() {
  process.env.TELEGRAM_TOKEN = "test:token";
  process.env.GROQ_KEY = "test:key";
  process.env.ALLOWED_USER_ID = "12345";
  process.env.CHAT_ID = "12345";
  process.env.GROQ_MODEL = "test-model";
}

module.exports = {
  clearToolCache,
  setTestEnv,
  ROOT,
};
