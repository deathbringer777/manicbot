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
 * Implementation notes (#M4):
 *   We use `sanitize-html` (battle-tested, parser-based) for the actual
 *   tag/attribute filtering. The previous in-house regex stripper handled
 *   the main vectors but was vulnerable to mutation-XSS payloads that abuse
 *   loose tag matching (e.g. `<i\nmg src=x onerror=alert(1)>`). A real HTML
 *   parser eliminates that whole class of bugs.
 *
 *   `sanitize-html` is pure JS (htmlparser2 under the hood, no DOM/JSDOM
 *   dependency) so it runs on the Cloudflare Pages edge runtime that powers
 *   admin-app. The escapeHtml / stripHtml / sanitizeAiOutput helpers below
 *   are kept as-is (they don't need a parser).
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
 * @see https://github.com/apostrophecms/sanitize-html
 */
import sanitizeHtmlLib from "sanitize-html";

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
    // `rel` is in the allowlist because transformTags below always injects
    // `rel="noopener noreferrer"` on outbound links — without it sanitize-html
    // would strip the very attribute we just added.
    a: ["href", "title", "rel"],
    span: ["class"],
  },
  salonBio: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "width", "height"],
  },
  marketingHtml: {
    // #S-06 — `style` attribute removed from every element. The regex
    // sanitizer cannot validate CSS payloads safely (think `background:
    // url(...)`, `expression(...)` legacy IE quirks, `@import` smuggling),
    // and email clients strip most inline styles anyway. Senders must use
    // attribute-based controls (`align`, `width`, etc.) — those are still
    // allowed here. When we move to DOMPurify on a Node runtime, `style`
    // can come back with a strict CSS allowlist.
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "width", "height"],
    td: ["colspan", "rowspan", "align", "valign", "width", "height"],
    th: ["colspan", "rowspan", "align", "valign", "width", "height"],
    div: ["class"],
    span: ["class"],
    p: [],
    table: ["border", "cellpadding", "cellspacing", "width", "align"],
  },
};

// ─── Tag + attribute stripper (sanitize-html, parser-based) ──────────────────

const SAFE_SCHEMES = ["http", "https", "mailto", "tel"] as const;

/**
 * Build a sanitize-html options object from one of our Profile entries.
 * `allowedAttributes` mirrors the per-tag allowlist we defined above; the
 * library will drop everything else.
 */
function buildOptions(profile: Profile): sanitizeHtmlLib.IOptions {
  const allowedTags = Array.from(ALLOWED_TAGS[profile]);
  const allowedAttributes: Record<string, string[]> = {};
  for (const [tag, attrs] of Object.entries(ALLOWED_ATTRS[profile])) {
    if (attrs.length > 0) allowedAttributes[tag] = [...attrs];
  }
  return {
    allowedTags,
    allowedAttributes,
    allowedSchemes: [...SAFE_SCHEMES],
    allowedSchemesByTag: {
      a: [...SAFE_SCHEMES],
      img: ["http", "https"],
    },
    allowedSchemesAppliedToAttributes: ["href", "src", "cite"],
    // Force noopener+noreferrer on external links — same behaviour as the
    // legacy regex sanitizer, but the library applies it deterministically.
    transformTags: {
      a: (tagName, attribs) => {
        if (attribs.href) {
          const href = String(attribs.href).trim();
          if (!/^(https?:\/\/|mailto:|tel:)/i.test(href)) {
            // Drop unsafe schemes — sanitize-html will also reject these via
            // allowedSchemes, but be explicit so a misconfigured profile
            // doesn't accidentally let one through.
            return { tagName: "span", attribs: {} };
          }
        }
        const next: Record<string, string> = { ...attribs };
        if (next.href && !next.rel) next.rel = "noopener noreferrer";
        return { tagName, attribs: next };
      },
    },
    // Strip ALL CSS — neutralises `style="background:url(...)"` and friends.
    // #S-06 — `style` was already excluded from `allowedAttributes` per profile,
    // but disabling style processing entirely eliminates any future regression
    // if a maintainer adds it back without thinking through CSS injection.
    allowedStyles: {},
    // Disallow ALL script-related content explicitly — defence in depth on top
    // of the tag allowlist.
    disallowedTagsMode: "discard" as const,
    enforceHtmlBoundary: true,
  };
}

/**
 * Strip tags not in the allowlist and remove dangerous attributes.
 * Backed by `sanitize-html` (htmlparser2 under the hood) so mutation-XSS
 * payloads that depend on loose regex parsing cannot bypass the filter.
 */
export function sanitizeHtml(input: string, profile: Profile): string {
  if (profile === "text") return escapeHtml(stripHtml(input));
  return sanitizeHtmlLib(input, buildOptions(profile));
}

/**
 * Sanitise a value that will be stored in the DB and later rendered as text
 * (not HTML). Equivalent to stripHtml + basic length truncation.
 */
export function sanitizeText(input: string, maxLen = 5000): string {
  return stripHtml(input).slice(0, maxLen);
}

/**
 * Sanitise a user-controlled string that will be interpolated into the
 * HTML body of an outbound email. Defends against:
 *
 *   - HTML injection (`<script>`, `<img onerror=>`, `<a href=javascript:>`),
 *     including unclosed tags that bleed into surrounding markup
 *   - Email header injection via CRLF (`\r\n` followed by a forged
 *     `Bcc:` / `Content-Type:` etc.). Resend uses JSON-bodied API so
 *     SMTP header smuggling is structurally blocked at the transport,
 *     but a CRLF in a display name still ends up in the visible
 *     greeting text and looks broken
 *   - RTL override (`U+202E`) — classic homograph trick that renders
 *     "doc.exe" as "exe.cod"; refuse leading override, allow legit
 *     embedded use (some Arabic / Hebrew names need it)
 *   - Zero-width characters (`U+200B-200D`, `U+FEFF`) used for invisible
 *     phishing payloads
 *   - Null bytes (`\x00`) — SQLite refuses them; render as empty
 *
 * Length cap: defaults to 100 chars (mailbox display name SHOULD fit
 * comfortably below the RFC 5322 `display-name` advisory 76-char line
 * limit, but we accept up to 100 to support multi-part names).
 *
 * @param input - raw user-supplied value (may be null/undefined)
 * @param maxLen - cap (default 100)
 * @returns sanitized string safe for HTML email interpolation; empty
 *          string if the input was null/undefined/non-string
 */
export function sanitizeEmailDisplayName(input: string | null | undefined, maxLen = 100): string {
  if (typeof input !== "string") return "";
  let s = input;
  // 1. Drop control bytes (NUL, CR, LF, TAB-newline, vertical tab, etc.)
  //    EXCEPT regular space U+0020. This kills CRLF header injection and
  //    any binary smuggling.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  s = s.replace(/[\r\n\t]/g, " ");
  // 2. Strip zero-width characters used for invisible payloads.
  s = s.replace(/[​-‍﻿]/g, "");
  // 3. Refuse a LEADING RTL override / LRO / RLO. A legit Arabic name
  //    may carry embedded override codepoints, but a leading one is
  //    almost always a phishing trick (e.g. "‮exe.doc" rendering as
  //    "doc.exe").
  s = s.replace(/^[‪-‮⁦-⁩‎‏]+/g, "");
  // 4. Strip all HTML tags. We're rendering into HTML email, so any
  //    user-supplied `<tag>` must be neutralised.
  s = stripHtml(s);
  // 5. HTML-escape the residue. After step 4 there shouldn't be any
  //    angle brackets left, but ampersands / quotes still need it.
  s = escapeHtml(s);
  // 6. Collapse runs of whitespace and trim.
  s = s.replace(/\s+/g, " ").trim();
  // 7. Cap length.
  return s.slice(0, maxLen);
}

/**
 * Sanitise a string that will become an email Subject:. Removes CRLF
 * (which would smuggle headers in non-JSON transports), tabs, and
 * caps at 200 chars (longer subjects are truncated by every major
 * MUA anyway).
 */
export function sanitizeEmailSubject(input: string | null | undefined, maxLen = 200): string {
  if (typeof input !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const cleaned = input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxLen);
}

/**
 * Cheap zod-friendly predicate: returns true if a name string contains
 * any character that would be rejected by `sanitizeEmailDisplayName`.
 * Used at the tRPC boundary in `webUsers.register` so we can fail-fast
 * with a localised error instead of silently rewriting the user's name.
 *
 * Allowed: letters (any script), digits, space, hyphen, apostrophe,
 * period. Almost every real-world name in RU/UA/EN/PL fits.
 *
 * Rejected (by negation): control chars, CRLF, `<`, `>`, `&`, `"`,
 * leading RTL/LRO/RLO override, zero-width chars.
 */
export function isSafeDisplayName(input: string): boolean {
  if (typeof input !== "string" || input.length === 0) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(input)) return false;
  if (/[<>&"]/.test(input)) return false;
  if (/[​-‍﻿]/.test(input)) return false;
  if (/^[‪-‮⁦-⁩‎‏]/.test(input)) return false;
  return true;
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
