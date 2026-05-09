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
