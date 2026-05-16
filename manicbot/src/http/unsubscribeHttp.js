/**
 * Public unsubscribe endpoint: GET /u/{token}.
 *
 * Renders a small "you're unsubscribed" page and flips the contact's
 * `unsubscribed=1`, `consent_email=0`, `consent_sms=0`. Always appends one
 * `marketing_consent_log` row with the source/IP/user-agent for the audit
 * trail.
 *
 * Design notes:
 *   - Token-based — no auth required. The token is 32 random hex chars,
 *     generated on the first send and persisted in marketing_contacts.
 *   - Idempotent — re-visiting after unsubscribe doesn't insert a duplicate
 *     consent row; we check if `unsubscribed = 1` already.
 *   - GET is fine here. Modern MUAs prefetch links but the side effect is
 *     "we'll stop emailing you" — that's the intended behaviour for any
 *     RFC-8058 one-click unsubscribe. No CSRF risk because no authenticated
 *     session is involved.
 *   - Friendly i18n HTML for the four supported locales — picks contact.locale
 *     if set, otherwise Accept-Language, otherwise ru.
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

  // Token shape check — guard against probing. Real tokens are 32 hex chars.
  if (typeof token !== 'string' || !/^[a-f0-9]{16,64}$/i.test(token)) {
    return pageShell({
      title: COPY.ru.notFound,
      body: COPY.ru.notFoundBody,
      home: COPY.ru.home,
      status: 404,
    });
  }

  let contact = null;
  try {
    contact = await dbGet(
      ctx,
      `SELECT id, locale, unsubscribed FROM marketing_contacts WHERE unsubscribe_token = ? LIMIT 1`,
      token,
    );
  } catch (e) {
    log.error('unsubscribe', e instanceof Error ? e : new Error(String(e?.message)));
  }

  const lang = pickLang(contact?.locale, request.headers.get('accept-language'));
  const copy = COPY[lang];

  if (!contact) {
    return pageShell({
      title: copy.notFound,
      body: copy.notFoundBody,
      home: copy.home,
      status: 404,
    });
  }

  // Idempotent: only flip + log if not already unsubscribed.
  if (!contact.unsubscribed) {
    const ip = request.headers.get('cf-connecting-ip') || '';
    const ua = (request.headers.get('user-agent') || '').slice(0, 500);
    const now = Math.floor(Date.now() / 1000);
    try {
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

  return pageShell({
    title: copy.title,
    body: copy.body,
    home: copy.home,
    status: 200,
  });
}
