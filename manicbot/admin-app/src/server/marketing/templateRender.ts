/**
 * Render a marketing template against a single contact.
 *
 * Supports merge variables: {{name}}, {{first_name}}, {{email}}, {{phone}},
 * {{salon}}, {{unsubscribe_url}}. Missing values render as empty strings.
 *
 * For email channel, the body is wrapped in a minimal HTML shell with a
 * footer that includes the unsubscribe link — every marketing email MUST
 * carry an unsubscribe entry point.
 */

export interface RenderContact {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}

export interface RenderContext {
  salonName?: string | null;
  unsubscribeUrl?: string | null;
  /** Locale of the rendered email; used for the unsubscribe footer copy. */
  locale?: "ru" | "ua" | "en" | "pl" | null;
}

export interface RenderTemplateInput {
  channel: "email" | "sms" | "whatsapp";
  subject?: string | null;
  body: string;
}

export interface RenderedMessage {
  subject: string;
  html: string;
  text: string;
}

const UNSUB_COPY: Record<NonNullable<RenderContext["locale"]>, string> = {
  ru: "Если вы больше не хотите получать письма — отписаться",
  ua: "Якщо ви більше не бажаєте отримувати листи — відписатися",
  en: "If you no longer want to receive emails — unsubscribe",
  pl: "Jeśli nie chcesz już otrzymywać e-maili — wypisz się",
};

function firstName(name?: string | null): string {
  if (!name) return "";
  const trimmed = name.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0] ?? "";
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function substitute(input: string, vars: Record<string, string>): string {
  // {{var}} or {{ var }} — case-insensitive name match.
  return input.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, name: string) => {
    const key = name.toLowerCase();
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] ?? "" : "";
  });
}

/**
 * Render a template into per-recipient subject/html/text.
 *
 * The function is intentionally pure — no DB, no fetch — so it's easy to
 * unit-test and reuse from both the admin-app sender and (mirrored) the
 * worker sender.
 */
export function renderTemplate(
  tpl: RenderTemplateInput,
  contact: RenderContact,
  ctx: RenderContext = {},
): RenderedMessage {
  const locale = ctx.locale ?? "ru";
  const unsubUrl = ctx.unsubscribeUrl ?? "";

  const vars: Record<string, string> = {
    name: contact.name ?? "",
    first_name: firstName(contact.name),
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    salon: ctx.salonName ?? "",
    unsubscribe_url: unsubUrl,
  };

  const subject = tpl.subject ? substitute(tpl.subject, vars) : "";

  if (tpl.channel === "email") {
    // Render body. If the template body is plain text (no <html> tag), we
    // wrap it in a minimal HTML shell so MUAs get well-formed HTML.
    const bodyRendered = substitute(tpl.body, vars);
    const html = wrapEmailHtml(bodyRendered, {
      unsubUrl,
      copy: UNSUB_COPY[locale],
    });
    // Plain-text alternative: strip tags + collapse whitespace + append unsub link.
    const textBody = stripTags(bodyRendered).trim();
    const textFooter = unsubUrl ? `\n\n— ${UNSUB_COPY[locale]}: ${unsubUrl}` : "";
    return { subject, html, text: `${textBody}${textFooter}` };
  }

  // sms / whatsapp — plain text only. No unsub footer auto-injected (SMS
  // unsubscribe is handled by STOP keyword at the provider level).
  const text = substitute(tpl.body, vars);
  return { subject: "", html: "", text };
}

function stripTags(s: string): string {
  return s
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/[ ]/g, " ");
}

function wrapEmailHtml(
  body: string,
  opts: { unsubUrl: string; copy: string },
): string {
  // Detect whether the body already contains a top-level <html> doc.
  const isFullDoc = /<\s*html[\s>]/i.test(body);
  const footer = opts.unsubUrl
    ? `<p style="margin-top:32px;color:#94a3b8;font-size:12px;line-height:1.5;">${escapeHtml(opts.copy)}: <a href="${escapeAttr(opts.unsubUrl)}" style="color:#94a3b8;">${escapeAttr(opts.unsubUrl)}</a></p>`
    : "";

  if (isFullDoc) {
    // Inject the footer just before </body> if present, else append.
    if (/<\/\s*body\s*>/i.test(body)) {
      return body.replace(/<\/\s*body\s*>/i, `${footer}</body>`);
    }
    return body + footer;
  }

  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;padding:24px;background:#f8fafc;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;font-size:15px;"><div style="max-width:560px;margin:0 auto;background:#ffffff;padding:32px;border-radius:12px;border:1px solid #e2e8f0;">${body}${footer}</div></body></html>`;
}

function escapeAttr(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
