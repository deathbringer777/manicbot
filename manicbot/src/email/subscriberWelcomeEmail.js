/**
 * Welcome email for newsletter subscribers (landing page form).
 *
 * Sent once, after the very first successful `POST /api/email-subscribe`
 * with a new email. Fire-and-forget — delivery failures are logged but
 * don't fail the HTTP response.
 *
 * Localized ru / uk / en / pl.
 */

const RESEND_API = 'https://api.resend.com/emails';

const COPY = {
  ru: {
    subject: 'Добро пожаловать в ManicBot — спасибо за подписку!',
    preheader: 'Telegram-бот, который сам записывает клиентов в ваш салон.',
    heading: 'Спасибо за интерес к ManicBot!',
    intro: 'Вы подписались на рассылку — обещаем присылать только полезное: обновления продукта, советы для салонов и иногда — специальные предложения. Без спама.',
    whatIsTitle: 'Что такое ManicBot?',
    whatIs: 'ManicBot — это Telegram-бот с AI-ассистентом, который берёт на себя запись клиентов в ваш салон красоты 24/7. Клиент пишет в бот — бот показывает свободные окна, подтверждает запись, напоминает о визите и синхронизирует всё с Google Calendar.',
    offerTitle: 'Что вы получаете',
    benefits: [
      '🤖 AI-ассистент отвечает на вопросы клиентов круглосуточно',
      '📅 Автоматическая запись и напоминания — минус 80% пропусков',
      '👥 Управление мастерами, услугами и расписанием в один клик',
      '💬 Все чаты в одном месте: Telegram, WhatsApp и Instagram',
      '📊 Аналитика загрузки, доходов и клиентской базы',
    ],
    ctaTitle: 'Хотите попробовать?',
    ctaText: 'Тариф Start — 45 zł/мес. 7 дней бесплатно, без карты.',
    ctaButton: 'Запустить свой бот',
    signOff: 'До встречи в эфире,<br>команда ManicBot',
    footer: 'Вы получили это письмо, потому что подписались на новости ManicBot. Вопросы? Напишите нам: support@manicbot.com',
  },
  uk: {
    subject: 'Ласкаво просимо до ManicBot — дякуємо за підписку!',
    preheader: 'Telegram-бот, який сам записує клієнтів до вашого салону.',
    heading: 'Дякуємо за інтерес до ManicBot!',
    intro: 'Ви підписались на розсилку — обіцяємо надсилати лише корисне: оновлення продукту, поради для салонів та іноді — спеціальні пропозиції. Без спаму.',
    whatIsTitle: 'Що таке ManicBot?',
    whatIs: 'ManicBot — це Telegram-бот з AI-асистентом, який бере на себе запис клієнтів до вашого салону краси 24/7. Клієнт пише в бот — бот показує вільні вікна, підтверджує запис, нагадує про візит і синхронізує все з Google Calendar.',
    offerTitle: 'Що ви отримуєте',
    benefits: [
      '🤖 AI-асистент відповідає на питання клієнтів цілодобово',
      '📅 Автоматичний запис і нагадування — мінус 80% пропусків',
      '👥 Керування майстрами, послугами та розкладом в один клік',
      '💬 Всі чати в одному місці: Telegram, WhatsApp та Instagram',
      '📊 Аналітика завантаження, доходів та клієнтської бази',
    ],
    ctaTitle: 'Хочете спробувати?',
    ctaText: 'Тариф Start — 45 zł/міс. 7 днів безкоштовно, без картки.',
    ctaButton: 'Запустити свій бот',
    signOff: 'До зустрічі в ефірі,<br>команда ManicBot',
    footer: 'Ви отримали цей лист, тому що підписались на новини ManicBot. Питання? Напишіть нам: support@manicbot.com',
  },
  en: {
    subject: 'Welcome to ManicBot — thanks for subscribing!',
    preheader: 'The Telegram bot that books clients into your salon on autopilot.',
    heading: 'Thanks for your interest in ManicBot!',
    intro: 'You’ve just subscribed to our newsletter — we promise to send only the good stuff: product updates, tips for salon owners, and occasionally a special offer. No spam.',
    whatIsTitle: 'What is ManicBot?',
    whatIs: 'ManicBot is a Telegram bot with an AI assistant that takes care of bookings for your beauty salon 24/7. A client messages the bot — the bot shows open slots, confirms the booking, sends reminders, and syncs everything with Google Calendar.',
    offerTitle: 'What you get',
    benefits: [
      '🤖 AI assistant answers client questions around the clock',
      '📅 Automatic bookings and reminders — up to 80% fewer no-shows',
      '👥 Manage masters, services, and schedule in one click',
      '💬 All client chats in one inbox: Telegram, WhatsApp, Instagram',
      '📊 Analytics on utilization, revenue, and customer base',
    ],
    ctaTitle: 'Want to try it?',
    ctaText: 'Start plan — 45 zł/mo. 7-day free trial, no card required.',
    ctaButton: 'Launch your bot',
    signOff: 'See you on the inside,<br>the ManicBot team',
    footer: 'You received this email because you subscribed to ManicBot news. Questions? Contact us: support@manicbot.com',
  },
  pl: {
    subject: 'Witamy w ManicBot — dziękujemy za subskrypcję!',
    preheader: 'Bot na Telegramie, który automatycznie zapisuje klientów do Twojego salonu.',
    heading: 'Dziękujemy za zainteresowanie ManicBot!',
    intro: 'Zapisałeś się do naszego newslettera — obiecujemy wysyłać tylko to, co warto: aktualizacje produktu, porady dla salonów i od czasu do czasu specjalne oferty. Bez spamu.',
    whatIsTitle: 'Czym jest ManicBot?',
    whatIs: 'ManicBot to bot na Telegramie z asystentem AI, który przejmuje zapisy klientów w Twoim salonie 24/7. Klient pisze do bota — bot pokazuje wolne terminy, potwierdza wizytę, przypomina o niej i synchronizuje wszystko z Kalendarzem Google.',
    offerTitle: 'Co otrzymujesz',
    benefits: [
      '🤖 Asystent AI odpowiada klientom przez całą dobę',
      '📅 Automatyczne zapisy i przypomnienia — nawet 80% mniej no-show',
      '👥 Zarządzanie mistrzami, usługami i grafikiem w jednym miejscu',
      '💬 Wszystkie czaty w jednej skrzynce: Telegram, WhatsApp, Instagram',
      '📊 Analityka obłożenia, przychodów i bazy klientów',
    ],
    ctaTitle: 'Chcesz spróbować?',
    ctaText: 'Plan Start — 45 zł/mies. 7 dni gratis, bez karty.',
    ctaButton: 'Uruchom swojego bota',
    signOff: 'Do zobaczenia,<br>zespół ManicBot',
    footer: 'Otrzymałeś ten e-mail, ponieważ zapisałeś się na nowości ManicBot. Pytania? Napisz do nas: support@manicbot.com',
  },
};

function normalizeLang(locale) {
  const l = String(locale || '').toLowerCase();
  if (l === 'ua') return 'uk';
  if (COPY[l]) return l;
  return 'ru';
}

function buildHtml(c, lang, ctaUrl) {
  const benefitsHtml = c.benefits
    .map(
      (b) =>
        `<tr><td class="mb-text-soft" style="padding:10px 0;font-size:15px;color:#334155;line-height:1.5;">${b}</td></tr>`,
    )
    .join('');

  // Palette strategy:
  //  - Baseline inline styles: white content card + dark CTA card. Both
  //    look good on clients that don't honor color-scheme / media queries.
  //  - `<meta name="color-scheme">` tells Apple Mail / iOS Mail / Outlook
  //    that we support both modes, suppressing aggressive auto-inversion.
  //  - `@media (prefers-color-scheme: dark)` tunes the white card to a
  //    dark card on capable clients. Gmail web strips this but our
  //    inline baseline is already legible.
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
    .mb-body { background:#0b1020 !important; }
    .mb-card { background:#0f172a !important; }
    .mb-text-strong { color:#f8fafc !important; }
    .mb-text-soft { color:#cbd5e1 !important; }
    .mb-footer { background:#111827 !important; }
    .mb-footer-text { color:#94a3b8 !important; }
  }
</style>
</head>
<body class="mb-body" style="margin:0;padding:0;background:#0b1020;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${c.preheader}</div>
<table class="mb-body" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1020;padding:32px 16px;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">

  <!-- Header / Hero -->
  <tr><td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#3b82f6 100%);border-radius:20px 20px 0 0;padding:40px 32px 32px;text-align:center;">
    <p style="margin:0 0 8px;font-size:32px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">ManicBot</p>
    <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:1.5px;text-transform:uppercase;">${c.preheader}</p>
  </td></tr>

  <!-- Body -->
  <tr><td class="mb-card" style="background:#ffffff;padding:40px 32px 32px;">
    <h1 class="mb-text-strong" style="margin:0 0 16px;font-size:24px;font-weight:800;color:#0f172a;letter-spacing:-0.4px;">${c.heading}</h1>
    <p class="mb-text-soft" style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#475569;">${c.intro}</p>

    <!-- What is -->
    <h2 class="mb-text-strong" style="margin:0 0 12px;font-size:18px;font-weight:700;color:#0f172a;">${c.whatIsTitle}</h2>
    <p class="mb-text-soft" style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#475569;">${c.whatIs}</p>

    <!-- Benefits -->
    <h2 class="mb-text-strong" style="margin:0 0 12px;font-size:18px;font-weight:700;color:#0f172a;">${c.offerTitle}</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
      ${benefitsHtml}
    </table>

    <!-- CTA card — always-dark palette so auto-inversion on iOS dark mode
         never flips dark text onto a light bg (the readability bug that
         triggered this rewrite). -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#1e1b4b;border-radius:14px;margin-bottom:24px;">
      <tr><td style="padding:24px 24px 28px;text-align:center;">
        <p style="margin:0 0 6px;font-size:17px;font-weight:700;color:#ffffff;">${c.ctaTitle}</p>
        <p style="margin:0 0 18px;font-size:14px;color:#c7d2fe;">${c.ctaText}</p>
        <a href="${ctaUrl}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 32px;border-radius:12px;box-shadow:0 6px 18px rgba(99,102,241,0.35);">
          ${c.ctaButton} →
        </a>
      </td></tr>
    </table>

    <p class="mb-text-soft" style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#475569;">${c.signOff}</p>
  </td></tr>

  <!-- Footer -->
  <tr><td class="mb-footer" style="background:#f1f5f9;border-radius:0 0 20px 20px;padding:20px 32px;text-align:center;">
    <p class="mb-footer-text" style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">${c.footer}</p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

/**
 * Send the subscriber welcome email via Resend.
 * @param {object} opts
 * @param {string} opts.resendKey
 * @param {string} opts.fromAddr  e.g. "ManicBot <noreply@manicbot.com>"
 * @param {string} opts.email
 * @param {string} opts.locale    ru | uk | ua | en | pl
 * @param {string} [opts.ctaUrl]  defaults to https://manicbot.com
 * @returns {Promise<boolean>}
 */
export async function sendSubscriberWelcomeEmail({ resendKey, fromAddr, email, locale, ctaUrl }) {
  if (!resendKey || !fromAddr || !email) return false;
  const lang = normalizeLang(locale);
  const c = COPY[lang];
  const html = buildHtml(c, lang, ctaUrl || 'https://manicbot.com');

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromAddr, to: [email], subject: c.subject, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[subscriberWelcome] Resend error:', res.status, body);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[subscriberWelcome] send failed:', e?.message);
    return false;
  }
}

export const _test = { COPY, normalizeLang, buildHtml };
