// HTML rendering helpers for Telegram messages (parse_mode: "HTML").
//
// Telegram's HTML supports a small tag set: <b> <i> <u> <s> <code> <pre>
// <a href> <tg-spoiler> <blockquote>. In text, only & < > must be escaped.
// We deliberately TRUNCATE long output (with a "… (+N)" note) instead of
// splitting it across messages — bounded, readable messages beat a wall of
// auto-split chunks, and it keeps <pre> blocks intact within one message.

const TG_LIMIT = 4096;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const b = (s) => `<b>${esc(s)}</b>`;
const i = (s) => `<i>${esc(s)}</i>`;
const code = (s) => `<code>${esc(s)}</code>`;

// Fenced/monospace block. `raw` is escaped; never pass pre-escaped text.
function pre(raw) {
  return `<pre>${esc(raw)}</pre>`;
}

// "Label: value" — label bolded; both escaped so values with <>& are safe.
function kv(label, value) {
  return `<b>${esc(label)}:</b> ${esc(value)}`;
}

// Title line + already-rendered body.
function section(title, body) {
  return `${b(title)}\n${body}`;
}

function divider() {
  return "──────────";
}

// 0..100 → "████░░░░░░ 40%"
function bar(pct, width = 10) {
  const p = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  const filled = Math.round((p / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled) + ` ${p}%`;
}

// Cap a multiline string to maxLines, appending a "+N more" note.
function truncateLines(text, maxLines, unit = "стр.") {
  const lines = String(text ?? "").split("\n");
  if (lines.length <= maxLines) return String(text ?? "");
  return `${lines.slice(0, maxLines).join("\n")}\n… (+${lines.length - maxLines} ${unit})`;
}

// Escaped <pre> block for raw command output, bounded by lines AND chars so the
// whole message stays well under Telegram's limit. Optional bold title above.
function block(raw, opts = {}) {
  const { maxLines = 40, maxChars = 3500, title } = opts;
  let body = String(raw ?? "").replace(/\s+$/, "");
  if (!body) body = "(пусто)";

  let note = "";
  const lines = body.split("\n");
  if (lines.length > maxLines) {
    body = lines.slice(0, maxLines).join("\n");
    note = `\n… (+${lines.length - maxLines} стр.)`;
  }
  if (body.length > maxChars) {
    body = body.slice(0, maxChars);
    note = "\n… (обрезано)";
  }
  const blockHtml = `<pre>${esc(body)}${note}</pre>`;
  return title ? `${b(title)}\n${blockHtml}` : blockHtml;
}

// Build an inline keyboard reply_markup from rows of [text, callbackData] pairs.
//   keyboard([[["▶️","m:play"],["⏸","m:pause"]], [["⏹ Стоп","m:stop"]]])
function keyboard(rows) {
  return {
    inline_keyboard: rows.map((row) =>
      row.map(([text, data]) => ({ text, callback_data: data })),
    ),
  };
}

// Last-ditch plain-text splitter (HTML stripped) for the rare over-limit case.
function chunkPlain(text, limit = TG_LIMIT) {
  const out = [];
  let rest = String(text ?? "");
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) out.push(rest);
  return out;
}

module.exports = {
  TG_LIMIT,
  esc,
  b,
  i,
  code,
  pre,
  kv,
  section,
  divider,
  bar,
  truncateLines,
  block,
  keyboard,
  chunkPlain,
};
