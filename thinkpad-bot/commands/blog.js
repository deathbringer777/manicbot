// /blog + blog:* callbacks — Telegram side of the blog approval pipeline.
//
// The nightly cron (~/manicbot-backend/crons/blog/autopilot.js) generates a
// draft and sends a preview with Publish / Revise / Schedule / Skip buttons.
// Taps land here and are relayed to crons/blog/publish.js, which does the
// actual D1 insert / skip / claude-powered revision and sends its own
// confirmation messages.
// A "Revise" tap arms a pending state: the owner's next plain-text message is
// taken as the revision feedback («отмена» cancels).
// A "Schedule" tap shows 3 smart weekday-morning time slots; the chosen slot
// is stored in scheduled-posts.json and bot.js publishes it at the right time.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const tg = require("../telegram.js");
const render = require("../render.js");

const deps = { execFile }; // test seam

const BACKEND_DIR = process.env.MANICBOT_BACKEND_DIR || path.join(os.homedir(), "manicbot-backend");
const PUBLISH_SCRIPT = path.join(BACKEND_DIR, "crons", "blog", "publish.js");
const ARTICLES_DIR = path.join(BACKEND_DIR, "marketing", "articles");
const DRAFTS_DIR = path.join(ARTICLES_DIR, "drafts");
const SCHEDULED_FILE = path.join(os.homedir(), "automation", "tg-bot", "scheduled-posts.json");
const ACTION_TIMEOUT_MS = 15 * 60 * 1000;

const LANGS = ["ru", "ua", "en", "pl"];
const LANG_LABELS = { ru: "🇷🇺 RU", ua: "🇺🇦 UA", en: "🇬🇧 EN", pl: "🇵🇱 PL" };

const pendingRevision = new Map();   // chatId → slug
const pendingSchedule = new Map();   // slug → [ts1, ts2, ts3] (unix seconds)

// ── Scheduling ─────────────────────────────────────────────────────────────────

function loadScheduled() {
  try { return JSON.parse(fs.readFileSync(SCHEDULED_FILE, "utf8")); } catch { return []; }
}

function saveScheduled(list) {
  try {
    fs.mkdirSync(path.dirname(SCHEDULED_FILE), { recursive: true });
    fs.writeFileSync(SCHEDULED_FILE, JSON.stringify(list, null, 2));
  } catch (e) {
    console.error("[blog] saveScheduled failed:", e.message);
  }
}

// Return posts whose publishAt has arrived (now is Date.now() ms by default).
function dueScheduled(now = Date.now()) {
  const nowTs = Math.floor(now / 1000);
  return loadScheduled().filter((p) => p.publishAt <= nowTs);
}

// Remove entries by slug after publishing.
function removeScheduledPosts(slugs) {
  const set = new Set(slugs);
  saveScheduled(loadScheduled().filter((p) => !set.has(p.slug)));
}

// Save or replace a scheduled entry.
function schedulePost(slug, ts) {
  const list = loadScheduled().filter((p) => p.slug !== slug);
  list.push({ slug, publishAt: ts, scheduledAt: Math.floor(Date.now() / 1000) });
  saveScheduled(list);
}

// Publish a due scheduled post and notify the owner.
async function publishScheduledPost(chatId, slug) {
  await tg.sendMessage(
    chatId,
    `⏰ Публикую по расписанию: <code>${render.esc(slug)}</code>…`,
    { parse_mode: "HTML" },
  );
  await runAction(slug, "publish");
}

// Suggest 3 next weekday 09:00 Warsaw slots (returns [{ts, label}]).
function suggestSlots(now = new Date()) {
  // Warsaw: UTC+2 (CEST, late-Mar→late-Oct) or UTC+1 (CET, otherwise)
  const month = now.getUTCMonth(); // 0-11
  const warsawOffset = month >= 2 && month <= 9 ? 2 : 1;
  const nineAmUtc = 9 - warsawOffset; // 09:00 Warsaw in UTC hours

  const slots = [];
  const cursor = new Date(now);

  for (let i = 1; i <= 10 && slots.length < 3; i++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setUTCHours(nineAmUtc, 0, 0, 0);
    const warsawDate = new Date(cursor.getTime() + warsawOffset * 3600000);
    const dow = warsawDate.getUTCDay();
    if (dow === 0 || dow === 6) continue; // skip weekends

    const label = cursor.toLocaleString("ru-RU", {
      timeZone: "Europe/Warsaw",
      weekday: "long", day: "numeric", month: "long",
      hour: "2-digit", minute: "2-digit",
    });
    slots.push({ ts: Math.floor(cursor.getTime() / 1000), label });
  }
  return slots;
}

// ── Draft helpers ──────────────────────────────────────────────────────────────

function listDrafts() {
  try {
    return fs.readdirSync(DRAFTS_DIR).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort();
  } catch {
    return [];
  }
}

function findDraft(slug) {
  for (const sub of ["drafts", "published", "skipped"]) {
    const file = path.join(ARTICLES_DIR, sub, `${slug}.json`);
    try {
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch { /* corrupt — try next dir */ }
  }
  return null;
}

function buildFullText(draft, lang) {
  const l = LANGS.includes(lang) ? lang : "ru";
  const a = draft.article;
  const words = String(a.bodies[l] || "").trim().split(/\s+/).length;
  return [
    `📖 <b>${render.esc(a.titles[l])}</b>  <i>(${LANG_LABELS[l]}, ${words} слов)</i>`,
    "",
    render.esc(a.bodies[l] || ""),
  ].join("\n");
}

function langKeyboard(slug) {
  return { inline_keyboard: [LANGS.map(l => ({ text: LANG_LABELS[l], callback_data: `blog:rl:${slug}:${l}` }))] };
}

async function sendArticle(chatId, slug, lang) {
  const draft = findDraft(slug);
  if (!draft) {
    await tg.sendMessage(chatId, `❌ Черновик <code>${render.esc(slug)}</code> не найден.`);
    return;
  }
  await tg.sendLongMessage(chatId, buildFullText(draft, lang), {
    parse_mode: "HTML",
    reply_markup: langKeyboard(slug),
  });
}

function runAction(slug, action, feedback) {
  const args = [PUBLISH_SCRIPT, "--slug", slug, "--action", action];
  if (feedback) args.push("--feedback", feedback);
  return new Promise((resolve, reject) => {
    deps.execFile("node", args, { timeout: ACTION_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).trim().slice(0, 400)));
      resolve(String(stdout).trim());
    });
  });
}

// ── Callback handler ───────────────────────────────────────────────────────────

async function handleCallback(cq) {
  const parts = (cq.data || "").split(":"); // blog:<action>:<slug>[:<extra>]
  const action = parts[1];
  const chatId = cq.message.chat.id;

  // Read full article or switch language
  if (action === "read" || action === "rl") {
    const lang = action === "rl" ? parts[parts.length - 1] : "ru";
    const slug = (action === "rl" ? parts.slice(2, -1) : parts.slice(2)).join(":");
    await tg.answerCallbackQuery(cq.id, "читаю…");
    await sendArticle(chatId, slug, lang);
    return;
  }

  // "Отложить" — show 3 weekday morning time slots
  if (action === "sched") {
    const slug = parts.slice(2).join(":");
    const slots = suggestSlots();
    pendingSchedule.set(slug, slots.map((s) => s.ts));
    await tg.answerCallbackQuery(cq.id, "выбери время");
    const keyboard = {
      inline_keyboard: [
        ...slots.map((s, i) => [{ text: `📅 ${s.label}`, callback_data: `blog:st:${slug}:${i}` }]),
        [{ text: "❌ Отмена", callback_data: `blog:read:${slug}` }],
      ],
    };
    return tg.editMessageText(
      chatId,
      cq.message.message_id,
      `📅 На когда отложить публикацию <code>${render.esc(slug)}</code>?\n\n<i>Время — 09:00 Warsaw, будний день.</i>`,
      { reply_markup: keyboard },
    );
  }

  // "blog:st:<slug>:<idx>" — confirm scheduled time
  if (action === "st") {
    const idx = parseInt(parts[parts.length - 1], 10);
    const slug = parts.slice(2, -1).join(":");
    const tsList = pendingSchedule.get(slug);
    const ts = tsList?.[idx];

    if (!ts) return tg.answerCallbackQuery(cq.id, "сессия истекла — открой статью снова");

    schedulePost(slug, ts);
    pendingSchedule.delete(slug);

    const when = new Date(ts * 1000).toLocaleString("ru-RU", {
      timeZone: "Europe/Warsaw",
      weekday: "long", day: "numeric", month: "long",
      hour: "2-digit", minute: "2-digit",
    });
    await tg.answerCallbackQuery(cq.id, "запланировано ✓");
    return tg.editMessageText(
      chatId,
      cq.message.message_id,
      `⏰ <b>Запланировано</b>\n<code>${render.esc(slug)}</code>\n📅 ${render.esc(when)} (Warsaw)`,
    );
  }

  const slug = parts.slice(2).join(":");

  if (action === "rev") {
    pendingRevision.set(chatId, slug);
    await tg.answerCallbackQuery(cq.id, "жду правки");
    await tg.sendMessage(
      chatId,
      `✏️ Напиши, что поправить в <code>${render.esc(slug)}</code> — следующее сообщение уйдёт как правка.\n<i>«отмена» — передумал.</i>`,
    );
    return;
  }

  const verb = action === "pub" ? "publish" : action === "skip" ? "skip" : null;
  if (!verb) return tg.answerCallbackQuery(cq.id, "—");

  await tg.answerCallbackQuery(cq.id, verb === "publish" ? "публикую…" : "пропускаю…");
  try {
    await runAction(slug, verb);
  } catch (e) {
    await tg.sendMessage(chatId, `❌ Блог (${verb} ${render.esc(slug)}): ${render.esc(e.message)}`);
  }
}

// ── Pending revision hook (called from bot.js before LLM) ─────────────────────

async function consumePendingRevision(chatId, text) {
  const slug = pendingRevision.get(chatId);
  if (!slug) return false;
  pendingRevision.delete(chatId);

  if (/^(отмена|cancel)\.?$/i.test(text.trim())) {
    await tg.sendMessage(chatId, "↩️ Правка отменена.");
    return true;
  }

  await tg.sendMessage(chatId, `✏️ Переделываю <code>${render.esc(slug)}</code> через Claude… (~1–2 мин)`);
  try {
    await runAction(slug, "revise", text);
  } catch (e) {
    await tg.sendMessage(chatId, `❌ Ревизия ${render.esc(slug)}: ${render.esc(e.message)}`);
  }
  return true;
}

module.exports = {
  commands: {
    "/blog": {
      handler: async () => {
        const drafts = listDrafts();
        if (!drafts.length) {
          return "📝 Черновиков нет. Автопилот генерит новый каждую ночь в 02:00 и присылает превью с кнопками.";
        }
        const text = [
          `📝 <b>Черновики ждут решения (${drafts.length}):</b>`,
          drafts.map(s => `• <code>${render.esc(s)}</code>`).join("\n"),
          "",
          "<i>Жми «Читать», чтобы открыть статью целиком. Кнопки Опубликовать/Переделать/Пропустить — в превью выше по чату.</i>",
        ].join("\n");
        const keyboard = {
          inline_keyboard: drafts.map(s => [{ text: `📖 ${s}`, callback_data: `blog:read:${s}` }]),
        };
        return { text, keyboard };
      },
      description: "Блог: черновики на аппруве",
    },
  },
  handleCallback,
  consumePendingRevision,
  dueScheduled,
  removeScheduledPosts,
  publishScheduledPost,
  suggestSlots,
  deps,
};
