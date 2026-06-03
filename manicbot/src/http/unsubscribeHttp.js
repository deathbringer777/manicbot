/**
 * Public unsubscribe endpoint: GET /u/{token} and POST /u/{token}.
 *
 * Serves two backends behind ONE URL pattern:
 *
 *   1. `marketing_contacts` (per-tenant CRM, primary). Flips
 *      `unsubscribed=1`, `consent_email=0`, `consent_sms=0`; appends one
 *      `marketing_consent_log` row.
 *
 *   2. `newsletter_subscribers` (platform-wide newsletter from /api/subscribe,
 *      0090). Flips `unsubscribed_at = now`. No separate consent log — the
 *      timestamp on the row IS the audit record.
 *
 * Lookup order: marketing_contacts first (it's the bigger table once the
 * marketing module is in use), then newsletter as a fallthrough. Token
 * shapes overlap by design — both tables mint 32-hex-char tokens; the
 * partial-UNIQUE on each side does not coordinate across tables, so in the
 * cosmically-unlikely event of a collision the marketing row wins.
 *
 * HTTP methods:
 *   - GET → renders a localised HTML "you're unsubscribed" page (200) or
 *     "link expired" (404). Modern MUAs prefetch links but the side effect
 *     is benign (we'll stop emailing you) so prefetch == real click here.
 *   - POST → RFC 8058 one-click (Gmail / Apple Mail "Unsubscribe" button).
 *     Returns 204 on success, 404 on unknown token. No body.
 *
 * Idempotent: re-visiting after unsubscribe doesn't double-flip or
 * double-log; we check the row's already-unsubscribed flag first.
 *
 * Localisation: picks contact.locale / subscriber.lang if set, otherwise
 * Accept-Language, otherwise ru.
 */
import { dbGet, dbRun } from '../utils/db.js';
import { log } from '../utils/logger.js';

const COPY = {
  ru: {
    title: 'Вы отписались',
    body: 'Мы больше не будем присылать вам маркетинговые письма от ManicBot. Если это случайно — напишите нам в чат поддержки.',
    home: 'На главную',
    notFound: 'Ссылка устарела',
    notFoundBody: 'Эта ссылка отписки уже не действительна. Возможно, вы уже отписались ранее.',
  },
  ua: {
    title: 'Ви відписалися',
    body: 'Ми більше не будемо надсилати вам маркетингові листи від ManicBot. Якщо це випадково — напишіть нам у чат підтримки.',
    home: 'На головну',
    notFound: 'Посилання застаріло',
    notFoundBody: 'Це посилання відписки вже не дійсне. Можливо, ви вже відписалися раніше.',
  },
  en: {
    title: 'You\'ve unsubscribed',
    body: 'We won\'t send you any more marketing emails from ManicBot. If this was a mistake — message us in support chat.',
    home: 'Back to home',
    notFound: 'Link expired',
    notFoundBody: 'This unsubscribe link is no longer valid. You may already be unsubscribed.',
  },
  pl: {
    title: 'Wypisano z listy',
    body: 'Nie będziemy więcej wysyłać Ci wiadomości marketingowych od ManicBot. Jeśli to pomyłka — napisz do nas w czacie wsparcia.',
    home: 'Strona główna',
    notFound: 'Link wygasł',
    notFoundBody: 'Ten link do wypisania się już nie jest ważny. Możliwe, że jesteś już wypisany.',
  },
};

function pickLang(contactLocale, acceptLanguage) {
  if (COPY[contactLocale]) return contactLocale;
  const al = String(acceptLanguage ?? '').toLowerCase();
  if (al.startsWith('uk')) return 'ua';
  if (al.startsWith('pl')) return 'pl';
  if (al.startsWith('en')) return 'en';
  return 'ru';
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pageShell({ title, body, home, status }) {
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body);
  const safeHome = escapeHtml(home);
  return new Response(
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${safeTitle}</title><meta name="robots" content="noindex,nofollow"/><style>body{margin:0;padding:24px;background:#f8fafc;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6}main{max-width:560px;margin:48px auto;background:#fff;padding:32px;border-radius:12px;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(0,0,0,.05)}h1{margin:0 0 12px;font-size:20px;color:#0f172a}p{margin:0 0 16px;color:#475569;font-size:15px}a.btn{display:inline-block;padding:10px 18px;border-radius:8px;background:#6d28d9;color:#fff;text-decoration:none;font-size:14px;font-weight:600}a.btn:hover{background:#5b21b6}</style></head><body><main><h1>${safeTitle}</h1><p>${safeBody}</p><a class="btn" href="https://manicbot.com/">${safeHome}</a></main></body></html>`,
    {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    },
  );
}

/**
 * Public unsubscribe — entry point.
 *
 * @param {Request} request
 * @param {string} token
 * @param {{ db: any }} env  Cloudflare Worker env (has DB binding).
 */
export async function handleUnsubscribeRequest(request, token, env) {
  // Minimal ctx for db helpers (they accept any object with .db).
  const ctx = { db: env?.DB };
  const isPost = String(request?.method || 'GET').toUpperCase() === 'POST';

  // Token shape check — guard against probing. Real tokens are 32 hex chars.
  if (typeof token !== 'string' || !/^[a-f0-9]{16,64}$/i.test(token)) {
    if (isPost) return new Response(null, { status: 404 });
    return pageShell({
      title: COPY.ru.notFound,
      body: COPY.ru.notFoundBody,
      home: COPY.ru.home,
      status: 404,
    });
  }

  // ── Primary: marketing_contacts (per-tenant CRM) ─────────────────────
  let contact = null;
  try {
    // tenant-scan-ignore: public unsubscribe — contact located by an unguessable per-contact unsubscribe_token (capability token; cross-tenant by design).
    contact = await dbGet(
      ctx,
      `SELECT id, locale, unsubscribed FROM marketing_contacts WHERE unsubscribe_token = ? LIMIT 1`,
      token,
    );
  } catch (e) {
    log.error('unsubscribe', e instanceof Error ? e : new Error(String(e?.message)));
  }

  if (contact) {
    if (!contact.unsubscribed) {
      const ip = request.headers.get('cf-connecting-ip') || '';
      const ua = (request.headers.get('user-agent') || '').slice(0, 500);
      const now = Math.floor(Date.now() / 1000);
      try {
        // tenant-scan-ignore: contact resolved above by the capability unsubscribe_token; update keyed by that row's id (authorize-then-act).
        await dbRun(
          ctx,
          `UPDATE marketing_contacts
             SET unsubscribed = 1, consent_email = 0, consent_sms = 0
           WHERE id = ?`,
          contact.id,
        );
        await dbRun(
          ctx,
          `INSERT INTO marketing_consent_log (contact_id, event, source, ip, user_agent, created_at)
           VALUES (?, 'unsubscribed', 'unsubscribe_link', ?, ?, ?)`,
          contact.id,
          ip,
          ua,
          now,
        );
      } catch (e) {
        log.error('unsubscribe', e instanceof Error ? e : new Error(String(e?.message)),
          { action: 'flip_unsubscribed', contactId: contact.id });
      }
    }
    if (isPost) return new Response(null, { status: 204 });
    const lang = pickLang(contact.locale, request.headers.get('accept-language'));
    const copy = COPY[lang];
    return pageShell({
      title: copy.title,
      body: copy.body,
      home: copy.home,
      status: 200,
    });
  }

  // ── Fallthrough: newsletter_subscribers (platform newsletter, 0090) ──
  let subscriber = null;
  try {
    subscriber = await dbGet(
      ctx,
      `SELECT id, lang, unsubscribed_at FROM newsletter_subscribers WHERE unsubscribe_token = ? LIMIT 1`,
      token,
    );
  } catch (e) {
    log.error('unsubscribe', e instanceof Error ? e : new Error(String(e?.message)));
  }

  if (subscriber) {
    if (!subscriber.unsubscribed_at) {
      try {
        await dbRun(
          ctx,
          `UPDATE newsletter_subscribers SET unsubscribed_at = ? WHERE id = ?`,
          Math.floor(Date.now() / 1000),
          subscriber.id,
        );
      } catch (e) {
        log.error('unsubscribe', e instanceof Error ? e : new Error(String(e?.message)),
          { action: 'flip_newsletter_unsubscribed', subscriberId: subscriber.id });
      }
    }
    if (isPost) return new Response(null, { status: 204 });
    const lang = pickLang(subscriber.lang, request.headers.get('accept-language'));
    const copy = COPY[lang];
    return pageShell({
      title: copy.title,
      body: copy.body,
      home: copy.home,
      status: 200,
    });
  }

  // ── Unknown token ────────────────────────────────────────────────────
  if (isPost) return new Response(null, { status: 404 });
  const lang = pickLang(null, request.headers.get('accept-language'));
  const copy = COPY[lang];
  return pageShell({
    title: copy.notFound,
    body: copy.notFoundBody,
    home: copy.home,
    status: 404,
  });
}
