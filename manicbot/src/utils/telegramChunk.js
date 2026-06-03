/**
 * Split a long string into Telegram-sendable chunks.
 *
 * Telegram caps a single sendMessage at 4096 chars; we use a 3500 safety
 * margin so HTML/Markdown parse_mode entities are never cut mid-tag. Splitting
 * prefers newline boundaries (keeps lines intact); a single line longer than
 * `max` is split by code points via Array.from so a surrogate pair (emoji) is
 * never severed.
 *
 * Extracted from the inline chunker in src/http/adminKeyHttp.js (/admin/notify)
 * so the admin/ops bot can reuse the exact same behavior for long replies
 * (error lists, bot-health reports, stats tables).
 *
 * @param {string} text
 * @param {number} [max=3500]
 * @returns {string[]} chunks (empty array for empty/blank input)
 */
export function splitTelegramText(text, max = 3500) {
  const str = String(text ?? '');
  if (!str) return [];
  const chunks = [];
  let buf = '';
  const pushBuf = () => { if (buf) { chunks.push(buf); buf = ''; } };
  for (const line of str.split('\n')) {
    const candidate = buf ? buf + '\n' + line : line;
    if (candidate.length <= max) { buf = candidate; continue; }
    pushBuf();
    if (line.length <= max) { buf = line; continue; }
    // Line itself exceeds max — split by code points, not code units.
    for (const ch of Array.from(line)) {
      if ((buf + ch).length > max) pushBuf();
      buf += ch;
    }
  }
  pushBuf();
  return chunks;
}
