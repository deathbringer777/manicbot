const config = require("./config.js");
const render = require("./render.js");

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

// Plain-text splitter for long, non-HTML messages (free-text LLM replies etc.).
async function sendLongMessage(chatId, text, extra = {}) {
  const chunks = render.chunkPlain(text, 4000);
  let last = { ok: true };
  for (const chunk of chunks) {
    last = await sendMessage(chatId, chunk, extra);
  }
  return last;
}

async function sendPhoto(chatId, photoPath, caption, replyMarkup) {
  if (typeof photoPath === "string" && photoPath.startsWith("/")) {
    const fs = require("fs");
    const blob = new Blob([fs.readFileSync(photoPath)]);
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("photo", blob, "image.png");
    if (caption) form.append("caption", caption);
    if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));
    const r = await fetch(`${TG}/sendPhoto`, { method: "POST", body: form });
    return r.json();
  }
  return api("sendPhoto", { chat_id: chatId, photo: photoPath, caption, reply_markup: replyMarkup });
}

// Unified reply dispatcher. A handler may return:
//   - a string                       → plain text (safe for raw shell output)
//   - { text, keyboard? }            → HTML message (text built via render.js)
//   - { photo, caption?, keyboard? } → photo
//   - null / ""                      → nothing sent
async function sendReply(chatId, out) {
  if (out == null || out === "") return { ok: true };

  if (typeof out === "string") return sendLongMessage(chatId, out);

  if (out.photo) {
    return sendPhoto(chatId, out.photo, out.caption, out.keyboard);
  }

  const extra = { parse_mode: "HTML" };
  if (out.keyboard) extra.reply_markup = out.keyboard;
  const text = String(out.text ?? "");
  if (text.length <= render.TG_LIMIT) return sendMessage(chatId, text, extra);

  // Over-limit HTML is rare (render.js truncates) — send the head, then the
  // remainder as plain text so a split tag can't break rendering.
  const head = text.slice(0, render.TG_LIMIT);
  await sendMessage(chatId, head, extra);
  return sendLongMessage(chatId, text.slice(render.TG_LIMIT));
}

async function editMessageText(chatId, messageId, text, extra = {}) {
  return api("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

async function answerCallbackQuery(callbackQueryId, text, showAlert = false) {
  return api("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text || "",
    show_alert: showAlert,
  });
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

// Curated "/" menu. Internal/expert commands (exec, ssh, proc control) are kept
// out of the menu to reduce clutter — they still work when typed.
const MENU_COMMANDS = [
  { command: "start", description: "🏠 Главное меню" },
  { command: "help", description: "❓ Все команды" },
  { command: "status", description: "📊 Система: CPU, память, диск, PM2" },
  { command: "ps", description: "🔄 Процессы PM2" },
  { command: "screenshot", description: "📸 Скриншот экрана" },
  { command: "play", description: "🎵 Музыка / радио" },
  { command: "np", description: "🎶 Что сейчас играет" },
  { command: "cron", description: "🕐 Запланированные задачи" },
  { command: "disk", description: "💾 Диски" },
  { command: "leads", description: "📋 Прогресс по лидам" },
  { command: "groq", description: "🤖 Лимиты Groq" },
  { command: "reset", description: "🧹 Очистить историю чата" },
];

async function registerCommands() {
  const result = await api("setMyCommands", { commands: MENU_COMMANDS });
  console.log(`[telegram] ${MENU_COMMANDS.length} menu commands registered`);
  return result;
}

module.exports = {
  api,
  sendMessage,
  sendLongMessage,
  sendPhoto,
  sendReply,
  editMessageText,
  answerCallbackQuery,
  sendTypingAction,
  keepTyping,
  isAllowedUser,
  registerCommands,
  MENU_COMMANDS,
};
