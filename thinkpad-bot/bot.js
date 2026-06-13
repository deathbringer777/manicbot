const config = require("./config.js");
const tg = require("./telegram.js");
const llm = require("./llm.js");
const tools = require("./tools.js");
const cmdRegistry = require("./commands/index.js");
const callbacks = require("./callbacks.js");
const intents = require("./intents.js");
const stt = require("./stt.js");
const vision = require("./vision.js");
const render = require("./render.js");

let offset = 0;
let pollRunning = true;
let backoff = 1000;
// Persist the poll offset OUTSIDE /tmp (cleared on reboot → would replay updates)
// and outside the deploy tree (~/automation/tg-bot is rsynced on deploy), so it
// survives both a reboot and a deploy.
const OFFSET_FILE = require("path").join(require("os").homedir(), "automation", ".tg-bot-offset.json");

// ── State persistence ─────────────────────────────────────────────────────────
function saveOffset() {
  try {
    require("fs").writeFileSync(OFFSET_FILE, JSON.stringify({ offset }));
  } catch {}
}
function loadOffset() {
  for (const file of [OFFSET_FILE, "/tmp/tg-bot-offset.json"]) { // new path, then legacy /tmp fallback (one-time migration)
    try {
      const d = JSON.parse(require("fs").readFileSync(file, "utf8"));
      if (d.offset) { offset = d.offset; return; }
    } catch {}
  }
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
  console.error("[bot] unhandled rejection:", err?.message || err);
});

// ── Command router ────────────────────────────────────────────────────────────
async function routeCommand(chatId, cmd, arg) {
  const entry = cmdRegistry.get(cmd);
  if (!entry) return false;

  const stopTyping = tg.keepTyping(chatId);
  try {
    const out = await entry.handler(chatId, arg);
    stopTyping();
    await tg.sendReply(chatId, out);
  } catch (e) {
    stopTyping();
    console.error("[cmd error]", e.message);
    await tg.sendMessage(chatId, `❌ Ошибка: ${e.message}`);
  }
  return true;
}

// Shared text pipeline: slash command → fast intent → LLM. Used by both typed
// messages and transcribed voice notes.
async function handleText(chatId, text) {
  // Images just sent? A following free-text line is their instruction — flush
  // the batch now with this text instead of routing it on its own. (A slash
  // command is left alone; the batch flushes on its own timer.)
  if (pendingImages.has(chatId) && !text.startsWith("/")) {
    return flushImages(chatId, text);
  }

  const [cmdRaw, ...argParts] = text.split(/\s+/);
  const cmd = cmdRaw.toLowerCase().split("@")[0];
  const arg = argParts.join(" ");

  if (await routeCommand(chatId, cmd, arg)) return;

  // A pending blog revision eats the next free-text message as feedback.
  try {
    const blog = require("./commands/blog.js");
    if (await blog.consumePendingRevision(chatId, text)) return;
  } catch (e) {
    console.error("[blog revision error]", e.message);
  }

  // Fast intents (screenshot, music, volume): instant, 0 tokens, survive rate limits.
  try {
    const intentOut = await intents.tryIntent(text);
    if (intentOut) { await tg.sendReply(chatId, intentOut); return; }
  } catch (e) {
    console.error("[intent error]", e.message);
  }

  // Free text → LLM (fire-and-forget so a long tool loop doesn't block polling).
  const stopTyping = tg.keepTyping(chatId);
  llm.ask(chatId, text)
    .then((reply) => { stopTyping(); return tg.sendLongMessage(chatId, reply); })
    .catch(async (e) => {
      stopTyping();
      console.error("[llm error]", e.message);
      // Swallow errors from the error-reply itself to avoid unhandledRejection.
      await tg.sendMessage(chatId, `❌ Ошибка: ${e.message}`).catch(() => {});
    });
}

// Voice / audio note → Whisper transcript → text pipeline.
async function handleVoice(chatId, media) {
  const stopTyping = tg.keepTyping(chatId);
  try {
    const r = await stt.transcribe(media.file_id);
    stopTyping();
    if (!r.ok || !r.text) {
      await tg.sendMessage(chatId, `🎤 Не разобрал голос: ${r.error || "пусто"}`);
      return;
    }
    await tg.sendReply(chatId, { text: `🎤 <i>${render.esc(r.text)}</i>` });
    await handleText(chatId, r.text.trim());
  } catch (e) {
    stopTyping();
    console.error("[voice error]", e.message);
    await tg.sendMessage(chatId, `❌ Голос: ${e.message}`);
  }
}

// ── Image / vision pipeline ─────────────────────────────────────────────────────
// The bot has no native image model: each photo is downloaded to disk and the
// claude agent VIEWS it with its Read tool (see vision.js). Telegram delivers
// each photo as its own update (an album as a burst), so we debounce — collect
// the images sent in a short window, then send ALL of them in one request. A
// free-text line typed right after becomes their instruction (see handleText);
// otherwise the batch flushes on the timer with a default prompt.
const IMAGE_BATCH_MS = 2500;
const pendingImages = new Map(); // chatId → { items: [{ path, caption }], timer }

async function bufferImage(chatId, msg) {
  const ref = vision.imageRefFromMessage(msg);
  if (!ref) return;

  let dl;
  try {
    dl = await vision.download(ref.fileId);
  } catch (e) {
    console.error("[image download error]", e.message);
    await tg.sendMessage(chatId, `❌ Не смог скачать изображение: ${e.message}`).catch(() => {});
    return;
  }

  const batch = pendingImages.get(chatId) || { items: [], timer: null };
  batch.items.push({ path: dl.path, caption: (msg.caption || "").trim() });
  if (batch.timer) clearTimeout(batch.timer);
  batch.timer = setTimeout(() => {
    flushImages(chatId).catch((e) => console.error("[vision flush]", e.message));
  }, IMAGE_BATCH_MS);
  pendingImages.set(chatId, batch);
}

async function flushImages(chatId, extraInstruction = "") {
  const batch = pendingImages.get(chatId);
  if (!batch || !batch.items.length) return;
  if (batch.timer) clearTimeout(batch.timer);
  pendingImages.delete(chatId);

  const captions = batch.items.map((i) => i.caption);
  const instruction = [extraInstruction, ...captions].map((s) => (s || "").trim()).filter(Boolean).join("\n");
  const prompt = vision.buildVisionPrompt({
    instruction,
    imagePaths: batch.items.map((i) => i.path),
  });

  const stopTyping = tg.keepTyping(chatId);
  try {
    const reply = await llm.ask(chatId, prompt);
    stopTyping();
    await tg.sendLongMessage(chatId, reply);
  } catch (e) {
    stopTyping();
    console.error("[vision error]", e.message);
    await tg.sendMessage(chatId, `❌ Ошибка анализа изображения: ${e.message}`).catch(() => {});
  }
}

// ── Poll loop ─────────────────────────────────────────────────────────────────
// Collapse repeated identical network errors so real errors aren't buried.
let _lastPollErr = null;
let _pollErrCount = 0;

function logPollError(msg) {
  if (msg === _lastPollErr) {
    _pollErrCount++;
    // Log at 3 and every 10 thereafter.
    if (_pollErrCount === 3 || _pollErrCount % 10 === 0) {
      console.error(`[poll error] ${msg} ×${_pollErrCount}`);
    }
  } else {
    if (_pollErrCount > 2) console.error(`[poll error] предыдущая повторялась ×${_pollErrCount}`);
    _lastPollErr = msg;
    _pollErrCount = 1;
    console.error("[poll error]", msg);
  }
}

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

      _lastPollErr = null;
      _pollErrCount = 0;
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
        if (!msg) continue;
        if (!tg.isAllowedUser(msg.from?.id)) continue;
        const chatId = msg.chat.id;

        // Voice / audio note → Whisper → same pipeline as typed text.
        if (msg.voice || msg.audio) {
          await handleVoice(chatId, msg.voice || msg.audio);
          continue;
        }

        // Photo (or an image sent as a document) → vision pipeline.
        if (msg.photo || (msg.document && vision.isImageDocument(msg.document))) {
          await bufferImage(chatId, msg);
          continue;
        }

        if (!msg.text) continue;
        await handleText(chatId, msg.text.trim());
      }
    } catch (e) {
      logPollError(e.message);
      backoff = Math.min(backoff * 2, 60000);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
}

// ── Scheduled-post publisher ──────────────────────────────────────────────────
// Checks scheduled-posts.json every 10 minutes and publishes due drafts.
async function checkScheduledPosts() {
  const blog = require("./commands/blog.js");
  const due = blog.dueScheduled();
  if (!due.length) return;
  for (const post of due) {
    try {
      await blog.publishScheduledPost(config.CHAT_ID, post.slug);
    } catch (e) {
      console.error("[scheduled-post error]", post.slug, e.message);
      await tg.sendMessage(config.CHAT_ID, `❌ Scheduled publish failed (${post.slug}): ${e.message}`).catch(() => {});
    }
  }
  blog.removeScheduledPosts(due.map((p) => p.slug));
}

console.log("ThinkPad ops-bot v5 starting...");
poll();
setInterval(() => checkScheduledPosts().catch((e) => console.error("[scheduler]", e.message)), 10 * 60 * 1000);
