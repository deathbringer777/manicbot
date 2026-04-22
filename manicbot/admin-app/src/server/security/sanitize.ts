/**
 * Centralised HTML/text sanitisation pipeline.
 *
 * All user-generated rich text AND AI outputs that will be stored in D1 or
 * rendered as HTML must pass through one of the functions below before being
 * persisted or returned to a client.
 *
 * Profiles:
 *   - "text"          — strips ALL HTML; returns plain text (safe for any context)
 *   - "chat"          — minimal inline markup (bold, italic, links, code)
 *   - "salonBio"      — richer marketing copy (headings, lists, links)
 *   - "marketingHtml" — broadest set used in email templates; still no scripts
 *
 * Implementation notes:
 *   We use a manual regex-based stripper that is safe in both Node and
 *   Cloudflare Workers edge runtimes (no DOM / JSDOM dependency).
 *   For production-grade projects with a Node runtime, swap this with
 *   isomorphic-dompurify once it is supported on Workers.
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Escape HTML entities to prevent XSS in text contexts. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Strip ALL HTML tags and return plain text.
 * Collapses whitespace; safe for SQL storage and plain-text email.
 */
export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ─── URL safety ─────────────────────────────────────────────────────────────

const SAFE_URL_RE = /^(https?:\/\/|mailto:|tel:)/i;

function safeHref(url: string): string {
  const trimmed = url.trim();
  if (!SAFE_URL_RE.test(trimmed)) return "#";
  // Block data: and javascript: even with whitespace tricks
  if (/^\s*javascript:/i.test(trimmed) || /^\s*data:/i.test(trimmed)) return "#";
  return trimmed;
}

// ─── Tag allowlists ──────────────────────────────────────────────────────────

type Profile = "text" | "chat" | "salonBio" | "marketingHtml";

const ALLOWED_TAGS: Record<Profile, Set<string>> = {
  text: new Set(),
  chat: new Set(["b", "strong", "i", "em", "u", "s", "code", "pre", "a", "br", "span"]),
  salonBio: new Set(["p", "b", "strong", "i", "em", "u", "s", "a", "ul", "ol", "li", "br", "h2", "h3", "blockquote", "code"]),
  marketingHtml: new Set(["p", "b", "strong", "i", "em", "u", "s", "a", "ul", "ol", "li", "br", "h1", "h2", "h3", "h4", "blockquote", "code", "pre", "img", "table", "thead", "tbody", "tr", "td", "th", "div", "span", "hr"]),
};

// Attributes allowed per tag in each profile
const ALLOWED_ATTRS: Record<Profile, Record<string, string[]>> = {
  text: {},
  chat: {
    a: ["href", "title"],
    span: ["class"],
  },
  salonBio: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "width", "height"],
  },
  marketingHtml: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "width", "height", "style"],
    td: ["colspan", "rowspan", "align", "valign", "style"],
    th: ["colspan", "rowspan", "align", "valign", "style"],
    div: ["class", "style"],
    span: ["class", "style"],
    p: ["style"],
    table: ["border", "cellpadding", "cellspacing", "style"],
  },
};

// ─── Tag + attribute stripper (no DOM required) ──────────────────────────────

/**
 * Strip tags not in the allowlist and remove dangerous attributes.
 * This is a best-effort defence-in-depth filter.  For a production deployment
 * facing complex HTML, replace with DOMPurify on a Node runtime.
 */
export function sanitizeHtml(input: string, profile: Profile): string {
  if (profile === "text") return escapeHtml(stripHtml(input));

  const allowedTags = ALLOWED_TAGS[profile];
  const allowedAttrs = ALLOWED_ATTRS[profile];

  // 1. Remove script / style / template / iframe blocks entirely (incl. content)
  let out = input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<template[\s\S]*?<\/template>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[^>]*>/gi, "")
    .replace(/<link[^>]*>/gi, "")
    .replace(/<meta[^>]*>/gi, "");

  // 2. Strip event-handler attributes (on*) and javascript: hrefs globally
  out = out.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "");
  out = out.replace(/(href|src|action)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, "$1=$2#$2");
  out = out.replace(/(href|src|action)\s*=\s*(['"])\s*data:[^'"]*\2/gi, "$1=$2#$2");

  // 3. Process each remaining tag — capture the closing slash separately.
  //    Group 1: closing slash (if present)
  //    Group 2: tag name
  //    Group 3: attribute string (only present on opening tags)
  out = out.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^>]*)?)\s*\/?>/g, (_match, closingSlash: string, tagName: string, attrStr: string) => {
    const lower = tagName.toLowerCase();
    if (!allowedTags.has(lower)) return ""; // strip disallowed tags

    // Closing tags get no attributes
    if (closingSlash === "/") return `</${lower}>`;

    // Rebuild allowed attributes only (opening tags)
    const permittedAttrs: string[] = (allowedAttrs[lower] ?? []);
    let cleanAttrs = "";

    if (permittedAttrs.length > 0 && attrStr) {
      const attrPairs = [...attrStr.matchAll(/(\w[\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g)];
      for (const [, name, dq, sq, bare] of attrPairs) {
        const attrName = name?.toLowerCase();
        if (!attrName || !permittedAttrs.includes(attrName)) continue;
        const val = dq ?? sq ?? bare ?? "";
        // Sanitise href / src / action values
        const sanitisedVal = (attrName === "href" || attrName === "src" || attrName === "action")
          ? safeHref(val)
          : val;
        cleanAttrs += ` ${attrName}="${escapeHtml(sanitisedVal)}"`;
      }
      // Force rel="noopener noreferrer" on external links
      if (lower === "a" && cleanAttrs.includes("href=")) {
        if (!cleanAttrs.includes("rel=")) {
          cleanAttrs += ' rel="noopener noreferrer"';
        }
      }
    }

    return `<${lower}${cleanAttrs}>`;
  });

  return out;
}

/**
 * Sanitise a value that will be stored in the DB and later rendered as text
 * (not HTML). Equivalent to stripHtml + basic length truncation.
 */
export function sanitizeText(input: string, maxLen = 5000): string {
  return stripHtml(input).slice(0, maxLen);
}

/**
 * Sanitise AI model output before storing or forwarding to a client.
 * AI outputs must never contain raw HTML action tags or injection payloads.
 */
export function sanitizeAiOutput(input: string): string {
  // Strip any residual action-tag patterns that slipped past the prompt filter
  // e.g. [BOOK:2024-01-01] or <BOOK:2024-01-01>
  return input
    .replace(/\[[\w_]+:[^\]]*\]/g, (m) => `(${m.slice(1, -1)})`) // [TAG:val] → (TAG:val)
    .replace(/<[\w_]+:[^>]*>/g, (m) => `(${m.slice(1, -1)})`)    // <TAG:val> → (TAG:val)
    .replace(/<[^>]{0,200}>/g, (m) => {
      // Keep a small set of Markdown-style tags that AI renders;
      // strip everything else to prevent XSS in frontends that do innerHTML
      const safe = /^<\/?(b|i|em|strong|code|pre|br|ul|ol|li|p)\s*\/?>$/i.test(m);
      return safe ? m : "";
    });
}
