const config = require("./config.js");

const TG = config.TG_API_BASE;

async function api(method, body) {
  const r = await fetch(`${TG}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function sendMessage(chatId, text, extra = {}) {
  return api("sendMessage", { chat_id: chatId, text, ...extra });
}

async function sendLongMessage(chatId, text) {
  const LIMIT = 4000;
  if (text.length <= LIMIT) return sendMessage(chatId, text);
  let remaining = text;
  while (remaining.length > 0) {
    let cut = remaining.lastIndexOf("\n", LIMIT);
    if (cut < LIMIT / 2) cut = LIMIT;
    await sendMessage(chatId, remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  return { ok: true };
}

async function sendPhoto(chatId, photoPath, caption) {
  if (typeof photoPath === "string" && photoPath.startsWith("/")) {
    const fs = require("fs");
    const blob = new Blob([fs.readFileSync(photoPath)]);
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("photo", blob, "screenshot.png");
    if (caption) form.append("caption", caption);
    const r = await fetch(`${TG}/sendPhoto`, { method: "POST", body: form });
    return r.json();
  }
  return api("sendPhoto", { chat_id: chatId, photo: photoPath, caption });
}

async function sendTypingAction(chatId) {
  return api("sendChatAction", { chat_id: chatId, action: "typing" });
}

function keepTyping(chatId) {
  sendTypingAction(chatId).catch(() => {});
  const i = setInterval(() => sendTypingAction(chatId).catch(() => {}), 4000);
  return () => clearInterval(i);
}

function isAllowedUser(userId) {
  return userId === config.ALLOWED_USER_ID;
}

async function registerCommands() {
  const cmdRegistry = require("./commands/index.js");
  const builtinCommands = [
    { command: "status", description: "CPU, память, диск, PM2" },
    { command: "ps", description: "Список PM2 процессов" },
    { command: "screenshot", description: "Скриншот экрана" },
    { command: "mouse", description: "Позиция курсора" },
    { command: "windows", description: "Список окон" },
    { command: "clipboard", description: "Буфер обмена" },
    { command: "leads", description: "Статистика лидов" },
    { command: "health", description: "Health check лог" },
    { command: "disk", description: "Использование дисков" },
    { command: "groq", description: "Токены и лимиты Groq API" },
    { command: "crons", description: "Список cron-задач" },
    { command: "reset", description: "Очистить историю чата" },
    { command: "help", description: "Справка по командам" },
  ];
  const dynamicCommands = cmdRegistry.getDescriptions();
  const result = await api("setMyCommands", {
    commands: [...builtinCommands, ...dynamicCommands],
  });
  console.log(`[telegram] ${builtinCommands.length + dynamicCommands.length} commands registered`);
  return result;
}

module.exports = {
  api,
  sendMessage,
  sendLongMessage,
  sendPhoto,
  sendTypingAction,
  keepTyping,
  isAllowedUser,
  registerCommands,
};
