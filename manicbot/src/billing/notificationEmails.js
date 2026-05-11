/**
 * #P1-5 (relax.md §5) — Worker-side dispatch for the new transactional
 * emails that fire from Stripe webhook events:
 *
 *   - `payment_failed`: invoice.payment_failed → grace_period flip → email.
 *   - `plan_upgrade`:   customer.subscription.updated with plan tier UP.
 *
 * The admin-app templates live in TypeScript on Cloudflare Pages and the
 * Worker cannot import from that bundle, so we re-render a slimmer copy
 * here. The wording and i18n keys are intentionally kept in lockstep with
 * `manicbot/admin-app/src/server/email/templates.ts` so future copy edits
 * can be diffed across the two files in a single review.
 *
 * Same Resend HTTP transport pattern as `invoiceEmail.js` — fire-and-forget
 * from the webhook handler so a slow Resend never blocks the 200 we owe
 * Stripe inside its retry window.
 */

import { dbGet } from '../utils/db.js';
import { log } from '../utils/logger.js';

const RESEND_API = 'https://api.resend.com/emails';
const PLAN_NAMES = { start: 'Start', pro: 'Pro', max: 'MAX' };

// Plan tier order. Used by the webhook to decide whether a
// `customer.subscription.updated` event is an UPGRADE (email) vs a
// downgrade / lateral move (no email).
export const PLAN_ORDER = ['start', 'pro', 'max'];

/**
 * Compute the integer rank (0..2) of a plan key. Returns -1 for unknown.
 * @param {string | null | undefined} plan
 * @returns {number}
 */
export function planRank(plan) {
  if (!plan) return -1;
  return PLAN_ORDER.indexOf(plan);
}

/**
 * True when `newPlan` is strictly higher in PLAN_ORDER than `oldPlan`.
 * Both must be known keys (`start | pro | max`) or the result is false —
 * unknown tiers never trigger the upgrade email by design.
 *
 * @param {string | null | undefined} oldPlan
 * @param {string | null | undefined} newPlan
 * @returns {boolean}
 */
export function isPlanUpgrade(oldPlan, newPlan) {
  const o = planRank(oldPlan);
  const n = planRank(newPlan);
  if (o < 0 || n < 0) return false;
  return n > o;
}

// ─── i18n copy ───────────────────────────────────────────────────────────
//
// Same surface as `templates.ts` (paymentFailed, planUpgrade keys). The
// Worker uses `'uk'` historically; we map it to `'ua'` (admin-app uses
// `'ua'` for Ukrainian) when looking up copy.

const COPY = {
  ru: {
    paymentFailed: {
      subject: 'Оплата не прошла — ManicBot',
      heading: 'Не удалось списать оплату',
      body: 'Мы не смогли списать оплату вашей подписки ManicBot. Возможно, истёк срок действия карты или недостаточно средств.',
      amount: 'Сумма',
      plan: 'Тариф',
      nextStep: 'Чтобы избежать отключения, обновите способ оплаты в кабинете.',
      cta: 'Обновить способ оплаты',
      grace: 'У вас есть 7 дней до отключения функций.',
    },
    planUpgrade: {
      subject: 'Ваш тариф обновлён — ManicBot',
      heading: 'Тариф обновлён',
      body: 'Спасибо за апгрейд! Расширенные возможности уже доступны.',
      from: 'Старый тариф',
      to: 'Новый тариф',
      cta: 'Перейти в кабинет',
      welcome: 'Откройте для себя все новые функции, которые включены в ваш план.',
    },
    footer: 'ManicBot.com — платформа для салонов красоты',
  },
  ua: {
    paymentFailed: {
      subject: 'Оплата не пройшла — ManicBot',
      heading: 'Не вдалося списати оплату',
      body: 'Ми не змогли списати оплату вашої підписки ManicBot. Можливо, термін дії картки закінчився або недостатньо коштів.',
      amount: 'Сума',
      plan: 'Тариф',
      nextStep: 'Щоб уникнути відключення, оновіть спосіб оплати в кабінеті.',
      cta: 'Оновити спосіб оплати',
      grace: 'У вас є 7 днів до відключення функцій.',
    },
    planUpgrade: {
      subject: 'Ваш тариф оновлено — ManicBot',
      heading: 'Тариф оновлено',
      body: 'Дякуємо за апгрейд! Розширені можливості вже доступні.',
      from: 'Старий тариф',
      to: 'Новий тариф',
      cta: 'Перейти до кабінету',
      welcome: 'Відкрийте для себе всі нові функції, які входять до вашого плану.',
    },
    footer: 'ManicBot.com — платформа для салонів краси',
  },
  en: {
    paymentFailed: {
      subject: 'Payment failed — ManicBot',
      heading: "We couldn't charge your card",
      body: 'We were unable to charge your ManicBot subscription. The card may be expired or have insufficient funds.',
      amount: 'Amount',
      plan: 'Plan',
      nextStep: 'To avoid service interruption, update your payment method in the dashboard.',
      cta: 'Update payment method',
      grace: 'You have 7 days before features are paused.',
    },
    planUpgrade: {
      subject: 'Your plan was upgraded — ManicBot',
      heading: 'Plan upgraded',
      body: 'Thanks for upgrading! The expanded features are now available on your account.',
      from: 'Previous plan',
      to: 'New plan',
      cta: 'Go to dashboard',
      welcome: 'Explore the new features that come with your plan.',
    },
    footer: 'ManicBot.com — beauty salon platform',
  },
  pl: {
    paymentFailed: {
      subject: 'Płatność nie powiodła się — ManicBot',
      heading: 'Nie udało się obciążyć karty',
      body: 'Nie udało nam się pobrać opłaty za Twoją subskrypcję ManicBot. Możliwe, że karta wygasła lub brakuje środków.',
      amount: 'Kwota',
      plan: 'Plan',
      nextStep: 'Aby uniknąć przerwy w działaniu, zaktualizuj sposób płatności w panelu.',
      cta: 'Zaktualizuj sposób płatności',
      grace: 'Masz 7 dni zanim funkcje zostaną wstrzymane.',
    },
    planUpgrade: {
      subject: 'Twój plan został zaktualizowany — ManicBot',
      heading: 'Plan zaktualizowany',
      body: 'Dziękujemy za upgrade! Rozszerzone funkcje są już dostępne na Twoim koncie.',
      from: 'Poprzedni plan',
      to: 'Nowy plan',
      cta: 'Przejdź do panelu',
      welcome: 'Odkryj nowe funkcje, które zawiera Twój plan.',
    },
    footer: 'ManicBot.com — platforma dla salonów kosmetycznych',
  },
};

function resolveCopy(rawLang) {
  // Some legacy rows store 'uk' for Ukrainian — admin-app uses 'ua'.
  const lang = rawLang === 'uk' ? 'ua' : rawLang;
  return COPY[lang] || COPY.en;
}

/**
 * Look up the best email address for a tenant (verified web_user OR
 * billing_email fallback). Same logic as `invoiceEmail.resolveEmail`.
 */
async function resolveEmail(ctx, tenantId) {
  const row = await dbGet(
    ctx,
    "SELECT email, lang FROM web_users WHERE tenant_id = ? AND role = 'tenant_owner' AND email_verified = 1 LIMIT 1",
    tenantId,
  );
  if (row?.email) return { email: row.email, lang: row.lang ?? 'en' };

  const tenant = await dbGet(ctx, 'SELECT billing_email FROM tenants WHERE id = ?', tenantId);
  if (tenant?.billing_email) return { email: tenant.billing_email, lang: 'en' };

  return null;
}

function fmtAmount(amountCents, currency) {
  const amount = (amountCents ?? 0) / 100;
  if ((currency || '').toLowerCase() === 'pln') {
    return `${amount.toFixed(2).replace('.', ',')} zł`;
  }
  return `${amount.toFixed(2)} ${(currency || 'EUR').toUpperCase()}`;
}

// ─── HTML rendering ──────────────────────────────────────────────────────
//
// Shape mirrors `templates.ts`'s baseLayout/ctaButton/paragraph helpers
// so the email looks identical to the admin-app side. Inline styles only.

function baseLayout(heading, body, footer) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0e1a;padding:40px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;background-color:#111827;border-radius:16px;border:1px solid rgba(255,255,255,0.06);overflow:hidden;">
  <tr><td style="padding:32px 32px 0;text-align:center;">
    <div style="display:inline-block;width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#06b6d4);text-align:center;line-height:48px;font-size:20px;font-weight:800;color:#fff;">M</div>
    <h1 style="margin:16px 0 0;font-size:22px;font-weight:700;color:#ffffff;">${heading}</h1>
  </td></tr>
  <tr><td style="padding:24px 32px 32px;">${body}</td></tr>
  <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
    <p style="margin:0;font-size:12px;color:#64748b;">${footer}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function ctaButton(url, text) {
  return `<div style="text-align:center;margin:24px 0;">
<a href="${url}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:12px;">${text}</a>
</div>`;
}

function paragraph(text, color = '#d1d5db') {
  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${color};">${text}</p>`;
}

function muted(text) {
  return paragraph(text, '#64748b');
}

export function paymentFailedHtml(c, { amountFormatted, planLabel, updateUrl }, footer) {
  const details = `<table style="margin:16px 0;width:100%;border-collapse:collapse;">
    <tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.06);">${c.amount}</td><td style="padding:8px 12px;font-size:13px;color:#e2e8f0;border-bottom:1px solid rgba(255,255,255,0.06);">${amountFormatted}</td></tr>
    <tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;">${c.plan}</td><td style="padding:8px 12px;font-size:13px;color:#e2e8f0;">${planLabel}</td></tr>
  </table>`;
  return baseLayout(
    c.heading,
    paragraph(c.body) + details + paragraph(c.nextStep) + ctaButton(updateUrl, c.cta) + muted(c.grace),
    footer,
  );
}

export function planUpgradeHtml(c, { oldLabel, newLabel, dashboardUrl }, footer) {
  const planRow = `<table style="margin:16px 0;width:100%;border-collapse:collapse;">
    <tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.06);">${c.from}</td><td style="padding:8px 12px;font-size:13px;color:#e2e8f0;border-bottom:1px solid rgba(255,255,255,0.06);">${oldLabel}</td></tr>
    <tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;">${c.to}</td><td style="padding:8px 12px;font-size:13px;color:#a78bfa;font-weight:600;">${newLabel}</td></tr>
  </table>`;
  return baseLayout(
    c.heading,
    paragraph(c.body) + planRow + paragraph(c.welcome) + ctaButton(dashboardUrl, c.cta),
    footer,
  );
}

async function postResend(resendKey, fromAddr, payload) {
  if (!resendKey || !fromAddr) return false;
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromAddr, ...payload }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log.error('billing.notify', new Error(`Resend error ${res.status}`), { status: res.status, body: body.slice(0, 200) });
      return false;
    }
    return true;
  } catch (e) {
    log.error('billing.notify', e instanceof Error ? e : new Error(String(e.message)));
    return false;
  }
}

/**
 * Send the `payment_failed` notification.
 *
 * @param {object} ctx - { db, ... }
 * @param {string} resendKey
 * @param {string} fromAddr
 * @param {string} tenantId
 * @param {object} invoice - Stripe invoice fields
 */
export async function sendPaymentFailedEmail(ctx, resendKey, fromAddr, tenantId, invoice) {
  if (!resendKey || !fromAddr || !tenantId) return false;
  const resolved = await resolveEmail(ctx, tenantId);
  if (!resolved) return false;

  const c = resolveCopy(resolved.lang);
  const tenantRow = await dbGet(ctx, 'SELECT plan FROM tenants WHERE id = ?', tenantId);
  const planKey = tenantRow?.plan ?? 'start';
  const planLabel = PLAN_NAMES[planKey] ?? planKey;

  const updateUrl = ((ctx.appBaseUrl || ctx.APP_BASE_URL || '').replace(/\/$/, '') || 'https://manicbot.com') + '/dashboard/billing';

  return postResend(resendKey, fromAddr, {
    to: [resolved.email],
    subject: c.paymentFailed.subject,
    html: paymentFailedHtml(
      c.paymentFailed,
      {
        amountFormatted: fmtAmount(invoice?.amount_due ?? invoice?.amount_remaining ?? 0, invoice?.currency ?? 'PLN'),
        planLabel,
        updateUrl,
      },
      c.footer,
    ),
  });
}

/**
 * Send the `plan_upgrade` notification.
 *
 * @param {object} ctx - { db, ... }
 * @param {string} resendKey
 * @param {string} fromAddr
 * @param {string} tenantId
 * @param {string} oldPlan - previous plan key
 * @param {string} newPlan - new plan key
 */
export async function sendPlanUpgradeEmail(ctx, resendKey, fromAddr, tenantId, oldPlan, newPlan) {
  if (!resendKey || !fromAddr || !tenantId) return false;
  if (!isPlanUpgrade(oldPlan, newPlan)) return false;

  const resolved = await resolveEmail(ctx, tenantId);
  if (!resolved) return false;

  const c = resolveCopy(resolved.lang);
  const oldLabel = PLAN_NAMES[oldPlan] ?? oldPlan;
  const newLabel = PLAN_NAMES[newPlan] ?? newPlan;
  const dashboardUrl = ((ctx.appBaseUrl || ctx.APP_BASE_URL || '').replace(/\/$/, '') || 'https://manicbot.com') + '/dashboard';

  return postResend(resendKey, fromAddr, {
    to: [resolved.email],
    subject: c.planUpgrade.subject,
    html: planUpgradeHtml(c.planUpgrade, { oldLabel, newLabel, dashboardUrl }, c.footer),
  });
}
