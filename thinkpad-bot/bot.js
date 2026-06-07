const config = require("./config.js");
const tg = require("./telegram.js");
const llm = require("./llm.js");
const tools = require("./tools.js");
const { COMMANDS } = require("./commands.js");
const cmdRegistry = require("./commands/index.js");
const callbacks = require("./callbacks.js");
const intents = require("./intents.js");

let offset = 0;
let pollRunning = true;
let backoff = 1000;
const OFFSET_FILE = "/tmp/tg-bot-offset.json";

// ── State persistence ─────────────────────────────────────────────────────────
function saveOffset() {
  try {
    require("fs").writeFileSync(OFFSET_FILE, JSON.stringify({ offset }));
  } catch {}
}
function loadOffset() {
  try {
    const d = JSON.parse(require("fs").readFileSync(OFFSET_FILE, "utf8"));
    if (d.offset) offset = d.offset;
  } catch {}
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`[bot] received ${signal}, shutting down...`);
  pollRunning = false;
  saveOffset();
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGQUIT", () => shutdown("SIGQUIT"));

process.on("uncaughtException", (err) => {
  console.error("[bot] uncaught exception:", err.message);
  saveOffset();
});
process.on("unhandledRejection", (err) => {
  console.error("[bot] unhandled rejection:", err.message);
});

// ── Command router ────────────────────────────────────────────────────────────
async function routeCommand(chatId, cmd, arg) {
  const dyn = cmdRegistry.get(cmd);
  const fn = dyn ? (c, a) => dyn.handler(c, a) : COMMANDS[cmd];
  if (!fn) return false;

  const stopTyping = tg.keepTyping(chatId);
  try {
    const out = await fn(chatId, arg);
    stopTyping();
    await tg.sendReply(chatId, out);
  } catch (e) {
    stopTyping();
    console.error("[cmd error]", e.message);
    await tg.sendMessage(chatId, `❌ Ошибка: ${e.message}`);
  }
  return true;
}

// ── Poll loop ─────────────────────────────────────────────────────────────────
async function poll() {
  cmdRegistry.loadBuiltin();
  loadOffset();
  await tg.registerCommands();
  console.log("[bot] v5 started — polling...");

  while (pollRunning) {
    try {
      const res = await fetch(
        `${config.TG_API_BASE}/getUpdates?offset=${offset}&timeout=${config.POLL_TIMEOUT}`
      );
      const { ok, result } = await res.json();
      if (!ok) {
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }

      backoff = 1000;

      for (const update of result) {
        offset = update.update_id + 1;

        // Inline-keyboard taps.
        if (update.callback_query) {
          const cq = update.callback_query;
          if (tg.isAllowedUser(cq.from?.id)) await callbacks.handle(cq);
          continue;
        }

        const msg = update.message;
        if (!msg?.text) continue;
        if (!tg.isAllowedUser(msg.from.id)) continue;

        const chatId = msg.chat.id;
        const text = msg.text.trim();
        const [cmdRaw, ...argParts] = text.split(/\s+/);
        const cmd = cmdRaw.toLowerCase().split("@")[0];
        const arg = argParts.join(" ");

        const handled = await routeCommand(chatId, cmd, arg);
        if (handled) continue;

        // Fast intent shortcuts (screenshot, music, volume) — instant, 0 tokens,
        // and they keep working when Groq is rate-limited.
        try {
          const intentOut = await intents.tryIntent(text);
          if (intentOut) {
            await tg.sendReply(chatId, intentOut);
            continue;
          }
        } catch (e) {
          console.error("[intent error]", e.message);
        }

        // Free text → LLM
        const stopTyping = tg.keepTyping(chatId);
        llm.ask(chatId, text)
          .then(reply => {
            stopTyping();
            return tg.sendLongMessage(chatId, reply);
          })
          .catch(async e => {
            stopTyping();
            console.error("[llm error]", e.message);
            await tg.sendMessage(chatId, `❌ Ошибка: ${e.message}`);
          });
      }
    } catch (e) {
      console.error("[poll error]", e.message);
      backoff = Math.min(backoff * 2, 60000);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
}

console.log("ThinkPad ops-bot v5 starting...");
poll();
