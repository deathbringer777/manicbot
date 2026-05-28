/**
 * Pure helpers for the newsletter DOI + unsubscribe HTTP surfaces.
 *
 * Extracted from the HTTP handlers so URL parsing, language resolution,
 * and the localized response pages can be unit-tested without D1, fetch,
 * or a Worker harness. The handlers in `confirmSubscriptionHttp.js` and
 * `newsletterUnsubscribeHttp.js` wrap these with rate limiting + D1 writes.
 */

import { isValidTokenShape } from '../services/newsletterTokens.js';

const ALLOWED_LANGS = Object.freeze(['ru', 'uk', 'en', 'pl']);

/**
 * Extract `token` from the URL query and validate its shape.
 *
 * @param {string} url
 * @returns {{ok:true, token:string} | {ok:false, error:'missing_token'|'invalid_token'}}
 */
export function parseTokenFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'missing_token' };
  }
  const raw = parsed.searchParams.get('token');
  if (!raw) return { ok: false, error: 'missing_token' };
  if (!isValidTokenShape(raw)) return { ok: false, error: 'invalid_token' };
  return { ok: true, token: raw };
}

/**
 * Map a row's `lang` column to a renderable page language.
 * `ua` is folded to `uk`; unknowns default to `ru`.
 *
 * @param {string | null | undefined} rowLang
 * @returns {'ru'|'uk'|'en'|'pl'}
 */
export function resolvePageLang(rowLang) {
  if (typeof rowLang !== 'string') return 'ru';
  const lower = rowLang.toLowerCase();
  if (lower === 'ua') return 'uk';
  if (ALLOWED_LANGS.includes(lower)) return lower;
  return 'ru';
}

// ─── Page copy ──────────────────────────────────────────────────────────────

const CONFIRM_SUCCESS_COPY = {
  ru: {
    title: 'Подписка подтверждена — ManicBot',
    heading: 'Подписка подтверждена!',
    body: 'Спасибо! Письмо с приветствием уже на пути в ваш ящик. Раз в месяц мы будем присылать только то, что реально стоит внимания.',
    cta: 'Открыть manicbot.com',
  },
  uk: {
    title: 'Підписку підтверджено — ManicBot',
    heading: 'Підписку підтверджено!',
    body: 'Дякуємо! Привітальний лист уже на шляху до вашої скриньки. Раз на місяць ми надсилатимемо лише те, що справді варте уваги.',
    cta: 'Відкрити manicbot.com',
  },
  en: {
    title: 'Subscription confirmed — ManicBot',
    heading: 'Subscription confirmed!',
    body: "Thanks! A welcome email is on its way to your inbox. Once a month we'll send only what's actually worth your time.",
    cta: 'Open manicbot.com',
  },
  pl: {
    title: 'Subskrypcja potwierdzona — ManicBot',
    heading: 'Subskrypcja potwierdzona!',
    body: 'Dziękujemy! E-mail powitalny jest już w drodze. Raz w miesiącu wyślemy tylko to, co naprawdę warto wiedzieć.',
    cta: 'Otwórz manicbot.com',
  },
};

const CONFIRM_EXPIRED_COPY = {
  ru: {
    title: 'Срок ссылки истёк — ManicBot',
    heading: 'Срок действия ссылки истёк',
    body: 'Ссылка подтверждения была действительна 7 дней и уже просрочена. Подпишитесь заново — мы пришлём свежее письмо.',
    cta: 'Подписаться снова',
  },
  uk: {
    title: 'Термін посилання закінчився — ManicBot',
    heading: 'Термін дії посилання закінчився',
    body: 'Посилання підтвердження було дійсним 7 днів і вже прострочене. Підпишіться знову — ми надішлемо свіжий лист.',
    cta: 'Підписатися знову',
  },
  en: {
    title: 'Link expired — ManicBot',
    heading: 'This confirmation link has expired',
    body: 'The link was valid for 7 days and has expired. Subscribe again and we will send a fresh email.',
    cta: 'Subscribe again',
  },
  pl: {
    title: 'Link wygasł — ManicBot',
    heading: 'Link potwierdzenia wygasł',
    body: 'Link był ważny przez 7 dni i już wygasł. Zapisz się ponownie — wyślemy nowy e-mail.',
    cta: 'Zapisz się ponownie',
  },
};

const UNSUB_SUCCESS_COPY = {
  ru: {
    title: 'Вы отписаны — ManicBot',
    heading: 'Вы отписаны от рассылки',
    body: 'Готово. Больше писем от ManicBot не будет. Передумаете — подпишитесь снова на manicbot.com.',
    cta: 'Открыть manicbot.com',
  },
  uk: {
    title: 'Вас відписано — ManicBot',
    heading: 'Вас відписано від розсилки',
    body: 'Готово. Більше листів від ManicBot не буде. Передумаєте — підпишіться знову на manicbot.com.',
    cta: 'Відкрити manicbot.com',
  },
  en: {
    title: 'Unsubscribed — ManicBot',
    heading: "You've been unsubscribed",
    body: 'Done. No more emails from ManicBot. Changed your mind? Subscribe again at manicbot.com.',
    cta: 'Open manicbot.com',
  },
  pl: {
    title: 'Wypisano — ManicBot',
    heading: 'Zostałeś wypisany',
    body: 'Gotowe. Nie wyślemy więcej e-maili. Zmieniłeś zdanie? Zapisz się ponownie na manicbot.com.',
    cta: 'Otwórz manicbot.com',
  },
};

const ERROR_COPY = {
  ru: {
    title: 'Ошибка — ManicBot',
    heading: 'Что-то пошло не так',
    body: 'Ссылка недействительна или истекла. Если вы только что нажали на свежее письмо — попробуйте ещё раз через минуту.',
    cta: 'На главную',
  },
  uk: {
    title: 'Помилка — ManicBot',
    heading: 'Щось пішло не так',
    body: 'Посилання недійсне або застаріле. Якщо ви щойно натиснули на свіжий лист — спробуйте ще раз за хвилину.',
    cta: 'На головну',
  },
  en: {
    title: 'Error — ManicBot',
    heading: 'Something went wrong',
    body: 'This link is invalid or expired. If you just clicked a fresh email, try again in a minute.',
    cta: 'Open homepage',
  },
  pl: {
    title: 'Błąd — ManicBot',
    heading: 'Coś poszło nie tak',
    body: 'Link jest nieprawidłowy lub wygasł. Jeśli właśnie kliknąłeś świeży e-mail — spróbuj ponownie za minutę.',
    cta: 'Otwórz stronę główną',
  },
};

function shell(lang, copy, ctaUrl) {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${copy.title}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 0; min-height: 100vh; background: #0b1020;
    color: #1e293b;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex; align-items: center; justify-content: center;
  }
  .card {
    max-width: 480px; width: calc(100% - 32px); margin: 32px 16px;
    background: #ffffff; border-radius: 20px; padding: 40px 32px;
    box-shadow: 0 24px 60px rgba(0,0,0,0.35);
    text-align: center;
  }
  @media (prefers-color-scheme: dark) {
    .card { background: #0f172a; color: #f8fafc; }
    .body { color: #cbd5e1 !important; }
  }
  .hero {
    width: 72px; height: 72px; margin: 0 auto 18px;
    background: linear-gradient(135deg, #6366f1, #8b5cf6, #3b82f6);
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 30px; font-weight: 700;
  }
  h1 { margin: 0 0 12px; font-size: 24px; font-weight: 800; letter-spacing: -0.4px; }
  .body { margin: 0 0 24px; font-size: 15px; line-height: 1.65; color: #475569; }
  .cta {
    display: inline-block; padding: 14px 28px;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    color: #fff; text-decoration: none; font-weight: 600; font-size: 15px;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(99,102,241,0.35);
  }
  .brand { margin-top: 28px; font-size: 12px; color: #94a3b8; }
</style>
</head>
<body>
  <div class="card">
    <div class="hero">✓</div>
    <h1>${copy.heading}</h1>
    <p class="body">${copy.body}</p>
    <a class="cta" href="${ctaUrl}">${copy.cta}</a>
    <p class="brand">ManicBot.com</p>
  </div>
</body>
</html>`;
}

/** Subscription confirmed landing page. */
export function renderConfirmSuccessPage(lang) {
  const c = CONFIRM_SUCCESS_COPY[lang] ?? CONFIRM_SUCCESS_COPY.ru;
  return shell(lang, c, 'https://manicbot.com');
}

/** Token expired landing page — links back to the landing for re-subscribe. */
export function renderConfirmExpiredPage(lang) {
  const c = CONFIRM_EXPIRED_COPY[lang] ?? CONFIRM_EXPIRED_COPY.ru;
  return shell(lang, c, 'https://manicbot.com/#newsletter');
}

/** Unsubscribe success landing page. */
export function renderUnsubscribeSuccessPage(lang) {
  const c = UNSUB_SUCCESS_COPY[lang] ?? UNSUB_SUCCESS_COPY.ru;
  return shell(lang, c, 'https://manicbot.com');
}

/** Generic error page (bad token, not found, internal). */
export function renderNewsletterErrorPage(lang) {
  const c = ERROR_COPY[lang] ?? ERROR_COPY.ru;
  return shell(lang, c, 'https://manicbot.com');
}
