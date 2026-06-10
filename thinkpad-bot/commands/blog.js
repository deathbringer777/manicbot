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
const DRAFTS_DIR = path.join(BACKEND_DIR, "marketing", "articles", "drafts");
const ACTION_TIMEOUT_MS = 15 * 60 * 1000; // revise runs claude — give it room

const pendingRevision = new Map(); // chatId → slug

function listDrafts() {
  try {
    return fs.readdirSync(DRAFTS_DIR).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort();
  } catch {
    return [];
  }
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
  const [, action, ...slugParts] = (cq.data || "").split(":"); // blog:pub:<slug>
  const slug = slugParts.join(":");
  const chatId = cq.message.chat.id;

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
        const list = drafts.map(s => `• <code>${render.esc(s)}</code>`).join("\n");
        return [
          `📝 <b>Черновики ждут решения (${drafts.length}):</b>`,
          list,
          "",
          "<i>Кнопки Опубликовать/Переделать/Пропустить — в сообщении-превью выше по чату (или придёт напоминание ночью).</i>",
        ].join("\n");
      },
      description: "Блог: черновики на аппруве",
    },
  },
  handleCallback,
  consumePendingRevision,
  deps,
};
