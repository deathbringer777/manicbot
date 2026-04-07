/**
 * Whitelist-based HTML sanitizer for bot messages.
 *
 * The bot emits Telegram HTML markup (<b>, <i>, <u>, <s>, <code>, <pre>,
 * <a href>, <br>). This function keeps only those tags and escapes everything
 * else, so a malicious or buggy upstream can't inject script/img/iframe tags
 * into the chat bubble. HTML entities (&amp;, &lt;, etc.) are preserved.
 *
 * Works everywhere (no DOMParser dependency).
 */

const ALLOWED_TAGS = new Set([
  "b", "strong",
  "i", "em",
  "u",
  "s", "strike",
  "code",
  "pre",
  "br",
  "a",
]);

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)(\s[^<>]*)?\/?\s*>/g;
const HREF_RE = /href\s*=\s*("([^"]*)"|'([^']*)')/i;

function escapeText(s: string): string {
  return s
    .replace(/&(?![#a-zA-Z0-9]+;)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function sanitizeChatHtml(html: string): string {
  if (!html) return "";
  // Normalize CR/LF → <br>
  const source = String(html).replace(/\r\n/g, "\n").replace(/\n/g, "<br>");

  const out: string[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(source)) !== null) {
    const text = source.slice(lastIndex, m.index);
    if (text) out.push(escapeText(text));
    lastIndex = TAG_RE.lastIndex;

    const raw = m[0];
    const tagName = m[1]!.toLowerCase();
    const isClose = raw.startsWith("</");

    if (!ALLOWED_TAGS.has(tagName)) {
      out.push(escapeText(raw));
      continue;
    }

    if (tagName === "a" && !isClose) {
      // Allow http(s) only; strip everything else.
      const attrs = m[2] ?? "";
      const hrefMatch = HREF_RE.exec(attrs);
      const href = hrefMatch?.[2] ?? hrefMatch?.[3] ?? "";
      if (/^https?:\/\//i.test(href)) {
        const safeHref = href
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;");
        out.push(`<a href="${safeHref}" target="_blank" rel="noopener noreferrer nofollow">`);
      } else {
        // Drop the anchor but keep its contents.
      }
      continue;
    }

    if (tagName === "br") {
      out.push("<br>");
      continue;
    }

    if (isClose) {
      out.push(`</${tagName}>`);
    } else {
      out.push(`<${tagName}>`);
    }
  }
  const tail = source.slice(lastIndex);
  if (tail) out.push(escapeText(tail));
  return out.join("");
}
