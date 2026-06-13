// vision.js — turn incoming Telegram images into a Claude vision request.
//
// The ops-bot has no native image model. Instead it downloads each photo to
// disk and lets the `claude` CLI SEE it through its Read tool — Read is already
// in the agent's allowlist (config.CLAUDE_ALLOWED_TOOLS) and renders images
// visually to the model. buildVisionPrompt() wraps the owner's instruction with
// the on-disk paths; bot.js feeds the result to llm.ask(), so the images join
// the per-chat session and a follow-up question keeps them in context. Billed
// to the Max subscription like every other text turn — no extra API key, no
// separate vision provider.
//
// The owner is the sole user (gated by ALLOWED_USER_ID), so the image bytes and
// caption are trusted input — the same trust model llm.ask() already applies to
// typed text.

const fs = require("fs");
const path = require("path");
const config = require("./config.js");

// Test seam: unit tests swap fetch/writeFile for fakes (no real net / disk).
const deps = {
  fetch: (...a) => fetch(...a),
  writeFile: (dest, buf) => fs.writeFileSync(dest, buf),
};

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic)$/i;
const DOWNLOAD_TIMEOUT_MS = 20000;
const TMP_DIR = "/tmp";

// Monotonic suffix so two images downloaded in the same millisecond (an album)
// never collide on the same /tmp path.
let _seq = 0;

const DEFAULT_INSTRUCTION =
  "Owner sent image(s) without a caption. Look at them carefully, say what they show, " +
  "and either do the obvious task they imply or ask what he wants done. Reply in Russian.";

// Telegram sends an ascending-resolution PhotoSize[]; the last/biggest wins.
function pickLargestPhotoId(photo) {
  if (!Array.isArray(photo) || !photo.length) return null;
  const best = photo.reduce((a, b) => {
    const sa = a.file_size || a.width || 0;
    const sb = b.file_size || b.width || 0;
    return sb >= sa ? b : a;
  });
  return best.file_id || null;
}

// A screenshot is often sent as an uncompressed *document* to preserve quality.
function isImageDocument(doc) {
  if (!doc) return false;
  if (typeof doc.mime_type === "string" && doc.mime_type.startsWith("image/")) return true;
  return IMAGE_EXT.test(doc.file_name || "");
}

// message → { fileId } | null. Pure.
function imageRefFromMessage(msg) {
  if (!msg) return null;
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const id = pickLargestPhotoId(msg.photo);
    return id ? { fileId: id } : null;
  }
  if (msg.document && isImageDocument(msg.document)) {
    return { fileId: msg.document.file_id };
  }
  return null;
}

// getFile → download bytes → write to /tmp. Returns { path }. Rejects on failure
// so bot.js can tell the owner instead of silently dropping the image.
async function download(fileId) {
  const info = await (await deps.fetch(`${config.TG_API_BASE}/getFile?file_id=${fileId}`)).json();
  if (!info.ok || !info.result || !info.result.file_path) {
    throw new Error("getFile не удался");
  }
  const remotePath = info.result.file_path;
  const url = `https://api.telegram.org/file/bot${config.TELEGRAM_TOKEN}/${remotePath}`;
  const res = await deps.fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`скачивание ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const ext = (path.extname(remotePath) || ".jpg").toLowerCase();
  const dest = path.join(TMP_DIR, `tg-img-${Date.now()}-${_seq++}${ext}`);
  deps.writeFile(dest, buf);
  return { path: dest };
}

// Compose the `-p` text for the claude CLI. The wrapper is English (instructions
// to the agent); the owner's instruction is carried verbatim as data.
function buildVisionPrompt({ instruction, imagePaths } = {}) {
  const paths = (imagePaths || []).filter(Boolean);
  if (!paths.length) throw new Error("buildVisionPrompt: no image paths");

  const list = paths.map((p, i) => `${i + 1}. ${p}`).join("\n");
  const task = (instruction && instruction.trim()) || DEFAULT_INSTRUCTION;
  const noun = paths.length === 1 ? "1 image" : `${paths.length} images`;

  return [
    `The owner sent ${noun} via this Telegram bot (screenshots or photos).`,
    `FIRST use your Read tool to VIEW every one of these local files:`,
    list,
    "",
    "Then act on his request below. If it asks you to run, check, fix or build",
    "something on the machine, actually do it (you have shell + the cron fleet) —",
    "don't just describe the picture.",
    "",
    `Request: ${task}`,
  ].join("\n");
}

module.exports = {
  pickLargestPhotoId,
  isImageDocument,
  imageRefFromMessage,
  download,
  buildVisionPrompt,
  deps,
};
