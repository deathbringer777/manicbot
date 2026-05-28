/**
 * Subscriber confirmation email — "You're on the list!"
 *
 * Sent once, immediately after a new email address is added to the ManicBot
 * mailing list via the landing-page subscribe form. This is a short, warm
 * acknowledgement — NOT the full product welcome email (see
 * subscriberWelcomeEmail.js for the feature-rich variant with benefits,
 * pricing, and a CTA button).
 *
 * Design: gradient header with the real ManicBot logo, success badge, 3
 * concise benefit bullets, and a one-click unsubscribe link. Dark mode
 * supported via @media (prefers-color-scheme: dark). Table-based layout;
 * inline styles throughout — compatible with Gmail, Apple Mail, Outlook.
 *
 * Localized: ru / uk / en / pl.
 *
 * @example
 *   await sendSubscriberConfirmEmail({
 *     resendKey: env.RESEND_API_KEY,
 *     fromAddr: 'ManicBot <news@manicbot.com>',
 *     email: 'subscriber@example.com',
 *     locale: 'en',
 *   });
 */

import { log } from '../utils/logger.js';

const RESEND_API = 'https://api.resend.com/emails';

// Absolute URL — must be reachable by email clients at send time.
// The file lives at manicbot/admin-app/public/manicbot-mark-ui.png and is
// served from https://manicbot.com/manicbot-mark-ui.png via the Worker proxy
// or from the Pages CDN. Email clients that block images will show the alt
// text ("ManicBot") while the gradient header still communicates the brand.
const LOGO_URL = 'https://manicbot.com/manicbot-mark-ui.png';

const COPY = {
  ru: {
    subject: 'Вы в списке! — ManicBot',
    preheader: 'Раз в месяц — только то, что реально стоит вашего времени.',
    heading: 'Вы в списке!',
    intro: 'Спасибо за подписку на обновления ManicBot. Раз в месяц мы будем присылать только то, что реально стоит внимания:',
    bullets: [
      { bold: 'Обновления продукта', rest: ' и новые функции для салонов и мастеров.' },
      { bold: 'Практические советы:', rest: ' запись, удержание клиентов, маркетинг.' },
      { bold: 'Истории команд,', rest: ' которые уже работают на ManicBot.' },
    ],
    zeroSpam: 'Без спама. Не хотите больше получать?',
    unsubLink: 'Отписаться в один клик',
    unsubSuffix: '.',
    footer: 'ManicBot.com — платформа для салонов красоты',
  },
  uk: {
    subject: 'Ви в списку! — ManicBot',
    preheader: 'Раз на місяць — тільки те, що справді варте вашого часу.',
    heading: 'Ви в списку!',
    intro: 'Дякуємо за підписку на оновлення ManicBot. Раз на місяць ми надсилатимемо лише те, що справді варте уваги:',
    bullets: [
      { bold: 'Оновлення продукту', rest: ' і нові функції для салонів і майстрів.' },
      { bold: 'Практичні поради:', rest: ' запис, утримання клієнтів, маркетинг.' },
      { bold: 'Історії команд,', rest: ' які вже працюють на ManicBot.' },
    ],
    zeroSpam: 'Без спаму. Не хочете більше отримувати?',
    unsubLink: 'Відписатися в один клік',
    unsubSuffix: '.',
    footer: 'ManicBot.com — платформа для салонів краси',
  },
  en: {
    subject: "You're on the list! — ManicBot",
    preheader: "Once a month — only what's actually worth your time.",
    heading: "You're on the list!",
    intro: "Thanks for subscribing to ManicBot updates. Once a month we'll send you what's actually worth your attention:",
    bullets: [
      { bold: 'Product updates', rest: ' and new features for salons and individual masters.' },
      { bold: 'Practical growth tips:', rest: ' booking, client retention, marketing.' },
      { bold: 'Stories from teams', rest: ' already running on ManicBot.' },
    ],
    zeroSpam: "Zero spam. Don't like it?",
    unsubLink: 'One-click unsubscribe',
    unsubSuffix: ' anytime.',
    footer: 'ManicBot.com — beauty salon platform',
  },
  pl: {
    subject: 'Jesteś na liście! — ManicBot',
    preheader: 'Raz w miesiącu — tylko to, co naprawdę warto przeczytać.',
    heading: 'Jesteś na liście!',
    intro: 'Dziękujemy za subskrypcję aktualizacji ManicBot. Raz w miesiącu będziemy wysyłać tylko to, co naprawdę warto wiedzieć:',
    bullets: [
      { bold: 'Aktualizacje produktu', rest: ' i nowe funkcje dla salonów i mistrzów.' },
      { bold: 'Praktyczne wskazówki:', rest: ' zapisy, retencja klientów, marketing.' },
      { bold: 'Historie zespołów,', rest: ' które już działają na ManicBot.' },
    ],
    zeroSpam: 'Zero spamu. Nie chcesz więcej?',
    unsubLink: 'Wypisz się jednym kliknięciem',
    unsubSuffix: '.',
    footer: 'ManicBot.com — platforma dla salonów kosmetycznych',
  },
};

function normalizeLang(locale) {
  const l = String(locale || '').toLowerCase();
  if (l === 'ua') return 'uk';
  if (COPY[l]) return l;
  return 'ru';
}

/**
 * Build the HTML string for the confirmation email.
 *
 * Palette strategy (identical to subscriberWelcomeEmail.js):
 *  - Baseline inline styles produce a readable light-mode layout in all
 *    clients, including those that ignore CSS entirely.
 *  - `<meta name="color-scheme">` suppresses iOS Mail's aggressive
 *    auto-inversion so the dark CTA card never gets inverted.
 *  - `@media (prefers-color-scheme: dark)` tunes the white body card to a
 *    dark slate surface for Apple Mail / iOS Mail / Samsung Mail. Gmail web
 *    strips this, but the inline baseline is already legible there.
 *
 * Outlook note: `border-radius` and `background:linear-gradient` on <td>
 * are not supported by Outlook's Word renderer. The circle shapes degrade
 * to squares and the gradient header degrades to the first stop colour
 * (#6366f1). Both are cosmetic-only regressions — all content remains
 * fully readable.
 *
 * @param {object} c         - COPY entry for the resolved locale
 * @param {string} lang      - BCP 47 language tag for the html[lang] attr
 * @param {string} unsubUrl  - full URL for the unsubscribe action
 * @returns {string}
 */
function buildHtml(c, lang, unsubUrl) {
  // Each bullet row: a purple checkmark cell + text cell.
  // Using a plain Unicode ✓ in a coloured <td> rather than a nested-table
  // gradient circle — this renders identically in all clients including
  // Outlook and avoids the background:gradient-on-td Outlook limitation.
  const bulletsHtml = c.bullets
    .map(
      (b) =>
        `<tr>
  <td width="28" valign="top" style="padding:10px 0;color:#6366f1;font-size:17px;font-weight:700;line-height:1.55;">✓</td>
  <td class="mb-text-soft" style="padding:10px 0;font-size:15px;color:#334155;line-height:1.55;">
    <strong class="mb-text-strong" style="color:#0f172a;">${b.bold}</strong>${b.rest}
  </td>
</tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${c.heading}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .mb-body        { background:#0b1020 !important; }
    .mb-card        { background:#0f172a !important; }
    .mb-text-strong { color:#f8fafc !important; }
    .mb-text-soft   { color:#cbd5e1 !important; }
    .mb-footer      { background:#111827 !important; }
    .mb-footer-text { color:#94a3b8 !important; }
  }
</style>
</head>
<body class="mb-body" style="margin:0;padding:0;background:#0b1020;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;">

<!-- Preheader text — hidden from view, shown in inbox preview -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${c.preheader}</div>

<table class="mb-body" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1020;padding:32px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

  <!-- ── Hero: gradient header with real ManicBot logo ────────────────── -->
  <tr><td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#3b82f6 100%);border-radius:20px 20px 0 0;padding:44px 32px 32px;text-align:center;">
    <!--[if mso]><table width="80" align="center"><tr><td><![endif]-->
    <img src="${LOGO_URL}"
         alt="ManicBot"
         width="80"
         height="80"
         style="display:block;margin:0 auto 18px;border-radius:50%;border:3px solid rgba(255,255,255,0.25);box-shadow:0 8px 32px rgba(0,0,0,0.3);">
    <!--[if mso]></td></tr></table><![endif]-->
    <p style="margin:0;font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">ManicBot</p>
    <p style="margin:5px 0 0;font-size:11px;font-weight:500;color:rgba(255,255,255,0.7);letter-spacing:2px;text-transform:uppercase;">Beauty Salon Platform</p>
  </td></tr>

  <!-- ── Body card ────────────────────────────────────────────────────── -->
  <tr><td class="mb-card" style="background:#ffffff;padding:40px 40px 36px;text-align:center;">

    <!-- Success badge: gradient circle with checkmark.
         Degrades to a coloured square in Outlook — still legible. -->
    <table align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 22px;">
      <tr><td width="52" height="52" align="center" valign="middle"
              style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:50%;font-size:26px;font-weight:700;color:#ffffff;line-height:52px;">
        ✓
      </td></tr>
    </table>

    <h1 class="mb-text-strong" style="margin:0 0 14px;font-size:28px;font-weight:800;color:#0f172a;letter-spacing:-0.5px;">${c.heading}</h1>

    <p class="mb-text-soft" style="margin:0 0 32px;font-size:15px;line-height:1.65;color:#475569;">${c.intro}</p>

    <!-- Benefit list -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px;text-align:left;">
      ${bulletsHtml}
    </table>

    <!-- Zero-spam / unsubscribe note -->
    <p class="mb-text-soft" style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;">
      ${c.zeroSpam}
      <a href="${unsubUrl}" style="color:#6366f1;text-decoration:underline;">${c.unsubLink}</a>${c.unsubSuffix}
    </p>

  </td></tr>

  <!-- ── Footer ───────────────────────────────────────────────────────── -->
  <tr><td class="mb-footer" style="background:#f1f5f9;border-radius:0 0 20px 20px;padding:20px 32px;text-align:center;">
    <p class="mb-footer-text" style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">${c.footer}</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

/**
 * Send the subscriber confirmation ("You're on the list!") email via Resend.
 *
 * @param {object} opts
 * @param {string} opts.resendKey   - Resend API key
 * @param {string} opts.fromAddr    - sender, e.g. "ManicBot <news@manicbot.com>"
 * @param {string} opts.email       - recipient address
 * @param {string} opts.locale      - ru | uk | ua | en | pl
 * @param {string} [opts.unsubUrl]  - full unsubscribe URL; defaults to
 *                                    https://manicbot.com/unsubscribe
 * @returns {Promise<boolean>}      - true on success, false on any failure
 */
export async function sendSubscriberConfirmEmail({ resendKey, fromAddr, email, locale, unsubUrl }) {
  if (!resendKey || !fromAddr || !email) return false;

  const lang = normalizeLang(locale);
  const c = COPY[lang];
  const html = buildHtml(c, lang, unsubUrl || 'https://manicbot.com/unsubscribe');

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromAddr, to: [email], subject: c.subject, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log.error('email.subscriberConfirm', new Error(`Resend error ${res.status}`), {
        status: res.status,
        body: body.slice(0, 200),
      });
      return false;
    }
    return true;
  } catch (e) {
    log.error('email.subscriberConfirm', e instanceof Error ? e : new Error(String(e?.message)));
    return false;
  }
}

export const _test = { COPY, normalizeLang, buildHtml };
