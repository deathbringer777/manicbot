// Inline-keyboard callback router. Navigation edits the current message in
// place (so the chat doesn't fill with duplicates); mutating process actions go
// through an ask → confirm → do flow.
const tg = require("./telegram.js");
const kb = require("./keyboards.js");
const render = require("./render.js");
const { sh } = require("./tools/helpers.js");

const SCREENS = {
  menu: "/start",
  status: "/status",
  ps: "/ps",
  cron: "/cron",
  disk: "/disk",
  groq: "/groq",
  help: "/help",
  shot: "/screenshot",
};

const ACTION_LABEL = { stop: "остановить", restart: "перезапустить", start: "запустить" };

// Lazy to avoid a load-time cycle (commands.js → keyboards.js, not callbacks.js).
function getCommands() {
  return require("./commands.js").COMMANDS;
}

async function editOrSend(cq, out) {
  const chatId = cq.message.chat.id;
  // A photo result can't replace a text message — send it fresh.
  if (out && out.photo) return tg.sendReply(chatId, out);
  const extra = out && out.keyboard ? { reply_markup: out.keyboard } : {};
  return tg.editMessageText(chatId, cq.message.message_id, (out && out.text) || "—", extra);
}

async function nav(cq, screen) {
  const key = SCREENS[screen];
  if (!key) return tg.answerCallbackQuery(cq.id, "—");
  await tg.answerCallbackQuery(cq.id);
  const out = await getCommands()[key](cq.message.chat.id);
  return editOrSend(cq, out);
}

async function ask(cq, token) {
  // token like "proc:stop:health-check"
  const [, action, ...nameParts] = token.split(":");
  const name = nameParts.join(":");
  await tg.answerCallbackQuery(cq.id);
  const text = `⚠️ <b>${ACTION_LABEL[action] || action}</b> процесс <code>${render.esc(name)}</code>?`;
  return tg.editMessageText(cq.message.chat.id, cq.message.message_id, text, {
    reply_markup: kb.confirm(token, "ps"),
  });
}

async function doAction(cq, token) {
  const parts = token.split(":");
  if (parts[0] !== "proc") return tg.answerCallbackQuery(cq.id, "—");
  const action = parts[1];
  const name = parts.slice(2).join(":");

  if (action === "logs") {
    await tg.answerCallbackQuery(cq.id, "логи…");
    const raw = await sh(`pm2 logs ${name} --lines 30 --nostream 2>&1`);
    const cleaned = raw
      .split("\n")
      .map((l) => l.replace(/^\d+\|[\w-]+\s*\|\s?/, ""))
      .filter((l) => l.trim())
      .join("\n");
    return editOrSend(cq, {
      text: render.block(cleaned, { title: `📜 ${name}`, maxLines: 30 }),
      keyboard: kb.screenKb("ps"),
    });
  }

  await tg.answerCallbackQuery(cq.id, "выполняю…");
  const out = await sh(`pm2 ${action} ${name} 2>&1`);
  const ok = !/error/i.test(out);
  return tg.editMessageText(
    cq.message.chat.id,
    cq.message.message_id,
    `${ok ? "✅" : "❌"} <b>pm2 ${action} ${render.esc(name)}</b>\n${render.block(out, { maxLines: 8 })}`,
    { reply_markup: kb.screenKb("ps") },
  );
}

async function handle(cq) {
  const data = cq.data || "";
  try {
    if (data === "noop") return await tg.answerCallbackQuery(cq.id);
    if (data.startsWith("blog:")) {
      return await require("./commands/blog.js").handleCallback(cq);
    }
    if (data.startsWith("nav:")) return await nav(cq, data.slice(4));
    if (data.startsWith("ask:")) return await ask(cq, data.slice(4));
    if (data.startsWith("do:")) return await doAction(cq, data.slice(3));
    if (data.startsWith("mus:")) {
      const music = require("./tools/music.js");
      return await music.handleCallback(cq); // wired in Phase 4
    }
    return await tg.answerCallbackQuery(cq.id, "—");
  } catch (e) {
    console.error("[callback error]", e.message);
    try { await tg.answerCallbackQuery(cq.id, "ошибка"); } catch { /* ignore */ }
  }
}

module.exports = { handle, SCREENS };
