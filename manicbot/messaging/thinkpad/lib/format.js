/**
 * format — newline-preserving body helpers for the messaging tier.
 *
 * The in-app announcement renderer is `whitespace-pre-wrap`, so paragraph
 * structure (`\n\n`) in a stored body shows up as real paragraphs. Generated
 * copy must therefore CARRY those breaks rather than be a single block ("wall
 * of text"). These two pure helpers are shared by `preset-generator.js` (tidy
 * fresh LLM output) and `reflow-templates.js` (re-paragraph legacy bodies).
 *
 * Mirror of the admin-app `sanitizeMessageBody` contract, Node-side: collapse
 * horizontal whitespace but keep `\n` / `\n\n`. (The Worker seam's `clean()`
 * still strips control chars + caps length on write — this is authoring-side
 * tidying, not the security boundary.)
 */

/**
 * Tidy a body while preserving line structure:
 *   - CRLF / lone CR → `\n`
 *   - strip control chars except `\n` (0x0A) and `\t` (0x09)
 *   - collapse runs of 2+ HORIZONTAL whitespace to one space (newlines kept)
 *   - trim trailing horizontal whitespace per line
 *   - collapse 3+ consecutive newlines to exactly 2
 *   - trim leading/trailing blank lines
 *
 * @param {string} text
 * @returns {string} normalized text ("" for non-string input)
 */
export function normalizeBody(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/[^\S\n]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Reflow a LEGACY single-paragraph body into 2–3 scannable paragraphs
 * (greeting / value / call-to-action), separated by a blank line.
 *
 * Idempotent: a body that already contains a paragraph break is returned
 * normalized but otherwise untouched, so re-running over already-fixed copy is
 * a no-op. A body with no sentence punctuation (nothing to split) is returned
 * as a single normalized line. Emoji and `{token}` placeholders are preserved.
 *
 * @param {string} text
 * @returns {string}
 */
export function reflowToParagraphs(text) {
  const normalized = normalizeBody(text);
  if (!normalized) return '';
  // Already structured → leave as-is (idempotent).
  if (/\n\n/.test(normalized)) return normalized;

  // Flatten any stray single newlines so sentence-splitting is clean.
  const flat = normalized.replace(/\n+/g, ' ').replace(/[^\S\n]{2,}/g, ' ').trim();
  // Split on whitespace that follows sentence-ending punctuation (keeps the
  // punctuation attached to its sentence). Lookbehind is supported on Node 18+.
  const sentences = flat
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length <= 1) return flat;

  let blocks;
  if (sentences.length === 2) {
    blocks = [sentences[0], sentences[1]];
  } else {
    // greeting = first, CTA = last, value = everything in between (one block).
    const greeting = sentences[0];
    const cta = sentences[sentences.length - 1];
    const value = sentences.slice(1, -1).join(' ');
    blocks = [greeting, value, cta];
  }
  return blocks.filter(Boolean).join('\n\n');
}
