// /blog + blog:* callbacks — Telegram side of the blog approval pipeline.
//
// The nightly cron (~/manicbot-backend/crons/blog/autopilot.js) generates a
// draft and sends a preview with Publish/Revise/Skip buttons. Taps land here
// and are relayed to crons/blog/publish.js, which does the actual D1 insert /
// skip / claude-powered revision and sends its own confirmation messages.
// A "Revise" tap arms a pending state: the owner's next plain-text message is
// taken as the revision feedback («отмена» cancels).

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
const ACTION_TIMEOUT_MS = 15 * 60 * 1000; // revise runs claude — give it room

const LANGS = ["ru", "ua", "en", "pl"];
const LANG_LABELS = { ru: "🇷🇺 RU", ua: "🇺🇦 UA", en: "🇬🇧 EN", pl: "🇵🇱 PL" };

const pendingRevision = new Map(); // chatId → slug

function listDrafts() {
  try {
    return fs.readdirSync(DRAFTS_DIR).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort();
  } catch {
    return [];
  }
}

// Read a draft regardless of lifecycle dir, so "Читать" works on an article the
// owner already published or skipped, not just a pending draft.
function findDraft(slug) {
  for (const sub of ["drafts", "published", "skipped"]) {
    const file = path.join(ARTICLES_DIR, sub, `${slug}.json`);
    try {
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch { /* corrupt file — try the next dir */ }
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

// One button per language to re-read in another language (blog:rl:<slug>:<lang>).
function langKeyboard(slug) {
  return { inline_keyboard: [LANGS.map(l => ({ text: LANG_LABELS[l], callback_data: `blog:rl:${slug}:${l}` }))] };
}

async function sendArticle(chatId, slug, lang) {
  const draft = findDraft(slug);
  if (!draft) {
    await tg.sendMessage(chatId, `❌ Черновик <code>${render.esc(slug)}</code> не найден.`);
    return;
  }
  // sendMessage has no default parse mode — HTML must be explicit or the
  // <b>/<i> tags leak as literal text. sendLongMessage chunks to the TG limit.
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

async function handleCallback(cq) {
  const parts = (cq.data || "").split(":"); // blog:<action>:<slug>[:<lang>]
  const action = parts[1];
  const chatId = cq.message.chat.id;

  // Read the full article (blog:read:<slug>) or switch language (blog:rl:<slug>:<lang>).
  if (action === "read" || action === "rl") {
    const lang = action === "rl" ? parts[parts.length - 1] : "ru";
    const slug = (action === "rl" ? parts.slice(2, -1) : parts.slice(2)).join(":");
    await tg.answerCallbackQuery(cq.id, "читаю…");
    await sendArticle(chatId, slug, lang);
    return;
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
    await runAction(slug, verb); // publish.js sends its own ✅/⏭ confirmation
  } catch (e) {
    await tg.sendMessage(chatId, `❌ Блог (${verb} ${render.esc(slug)}): ${render.esc(e.message)}`);
  }
}

// Called by bot.js for every free-text message BEFORE intents/LLM.
// Returns true when the text was consumed as revision feedback.
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
    await runAction(slug, "revise", text); // publish.js re-sends the preview with buttons
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
        // A "Читать" button per pending draft so the owner can review on demand.
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
  deps,
};
