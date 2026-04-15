/**
 * Invoice email sent after invoice.payment_succeeded via Resend.
 * Looks up tenant's verified web_user email (primary) or tenant.billingEmail (fallback).
 * Sends a branded HTML email with invoice amount, period, and Stripe hosted link.
 */

import { dbGet } from '../utils/db.js';

const RESEND_API = 'https://api.resend.com/emails';

// ─── i18n ────────────────────────────────────────────────────────────────────

const COPY = {
  ru: {
    subject: (invoice) => `Счёт #${invoice.number} — ManicBot ${invoice.planName}`,
    heading: 'Оплата прошла успешно',
    thankYou: (name) => `Спасибо, ${name}! Ваша подписка оплачена.`,
    plan: 'Тариф',
    amount: 'Сумма',
    period: 'Период',
    viewInvoice: 'Открыть счёт',
    footer: 'Вопросы? Напишите нам: support@manicbot.com',
  },
  uk: {
    subject: (invoice) => `Рахунок #${invoice.number} — ManicBot ${invoice.planName}`,
    heading: 'Оплата пройшла успішно',
    thankYou: (name) => `Дякуємо, ${name}! Вашу підписку оплачено.`,
    plan: 'Тариф',
    amount: 'Сума',
    period: 'Період',
    viewInvoice: 'Відкрити рахунок',
    footer: 'Питання? Напишіть нам: support@manicbot.com',
  },
  pl: {
    subject: (invoice) => `Faktura #${invoice.number} — ManicBot ${invoice.planName}`,
    heading: 'Płatność zakończona sukcesem',
    thankYou: (name) => `Dziękujemy, ${name}! Twoja subskrypcja została opłacona.`,
    plan: 'Plan',
    amount: 'Kwota',
    period: 'Okres',
    viewInvoice: 'Otwórz fakturę',
    footer: 'Pytania? Napisz do nas: support@manicbot.com',
  },
  en: {
    subject: (invoice) => `Invoice #${invoice.number} — ManicBot ${invoice.planName}`,
    heading: 'Payment successful',
    thankYou: (name) => `Thank you, ${name}! Your subscription has been paid.`,
    plan: 'Plan',
    amount: 'Amount',
    period: 'Period',
    viewInvoice: 'View invoice',
    footer: 'Questions? Contact us: support@manicbot.com',
  },
};

const PLAN_NAMES = { start: 'Start', pro: 'Pro', max: 'MAX' };

function fmtAmount(amountCents, currency) {
  const amount = amountCents / 100;
  if (currency.toLowerCase() === 'pln') {
    return `${amount.toFixed(2).replace('.', ',')} zł`;
  }
  return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
}

function fmtDate(unixSec, lang) {
  const locale = { ru: 'ru-RU', uk: 'uk-UA', pl: 'pl-PL', en: 'en-GB' }[lang] ?? 'pl-PL';
  return new Date(unixSec * 1000).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

function buildHtml(opts, c, lang) {
  const periodStr = `${fmtDate(opts.periodStart, lang)} — ${fmtDate(opts.periodEnd, lang)}`;
  const nextStr = opts.nextPaymentDate ? fmtDate(opts.nextPaymentDate, lang) : null;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${c.heading}</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);border-radius:16px 16px 0 0;padding:32px 32px 24px;text-align:center;">
    <p style="margin:0 0 8px;font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">ManicBot</p>
    <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.75);letter-spacing:1px;text-transform:uppercase;">${c.heading}</p>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:#fff;padding:32px;">
    <p style="margin:0 0 24px;font-size:16px;color:#334155;">${c.thankYou(opts.tenantName)}</p>

    <!-- Details table -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;overflow:hidden;margin-bottom:24px;">
      <tr>
        <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;">${c.plan}</td>
        <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:600;color:#1e293b;text-align:right;">${opts.planName}</td>
      </tr>
      <tr>
        <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;">${c.amount}</td>
        <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;font-size:15px;font-weight:700;color:#6366f1;text-align:right;">${opts.amountFormatted}</td>
      </tr>
      <tr>
        <td style="padding:14px 20px;${nextStr ? 'border-bottom:1px solid #e2e8f0;' : ''}font-size:13px;color:#64748b;">${c.period}</td>
        <td style="padding:14px 20px;${nextStr ? 'border-bottom:1px solid #e2e8f0;' : ''}font-size:13px;color:#1e293b;text-align:right;">${periodStr}</td>
      </tr>
      ${nextStr ? `<tr>
        <td style="padding:14px 20px;font-size:13px;color:#64748b;">${lang === 'ru' ? 'Следующий платёж' : lang === 'uk' ? 'Наступний платіж' : lang === 'pl' ? 'Następna płatność' : 'Next payment'}</td>
        <td style="padding:14px 20px;font-size:13px;color:#1e293b;text-align:right;">${nextStr}</td>
      </tr>` : ''}
    </table>

    ${opts.hostedInvoiceUrl ? `
    <!-- CTA button -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr><td align="center">
        <a href="${opts.hostedInvoiceUrl}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:14px 32px;border-radius:10px;">
          ${c.viewInvoice} →
        </a>
      </td></tr>
    </table>` : ''}

    <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">${opts.invoiceNumber ? `#${opts.invoiceNumber}` : ''}</p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f1f5f9;border-radius:0 0 16px 16px;padding:20px 32px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#94a3b8;">${c.footer}</p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Look up the best email address for a tenant:
 * 1. Verified tenant_owner web_user email
 * 2. tenant.billing_email
 * Returns null if neither is available.
 */
async function resolveEmail(ctx, tenantId) {
  // Prefer the verified web_user email
  const row = await dbGet(
    ctx,
    "SELECT email, lang FROM web_users WHERE tenant_id = ? AND role = 'tenant_owner' AND email_verified = 1 LIMIT 1",
    tenantId,
  );
  if (row?.email) return { email: row.email, lang: row.lang ?? 'ru' };

  // Fallback to billing_email on tenants
  const tenant = await dbGet(ctx, 'SELECT billing_email FROM tenants WHERE id = ?', tenantId);
  if (tenant?.billing_email) return { email: tenant.billing_email, lang: 'ru' };

  return null;
}

/**
 * Send a payment invoice email via Resend.
 *
 * @param {object} ctx - { db }
 * @param {string} resendKey
 * @param {string} fromAddr  e.g. "ManicBot <noreply@manicbot.com>"
 * @param {string} tenantId
 * @param {object} invoice   - Stripe invoice fields
 */
export async function sendInvoiceEmail(ctx, resendKey, fromAddr, tenantId, invoice) {
  if (!resendKey || !fromAddr || !tenantId) return false;

  const resolved = await resolveEmail(ctx, tenantId);
  if (!resolved) return false;

  const { email, lang } = resolved;
  const c = COPY[lang] ?? COPY.ru;

  // Get tenant name/plan for personalisation
  const tenantRow = await dbGet(ctx, 'SELECT name, plan FROM tenants WHERE id = ?', tenantId);
  const tenantName = tenantRow?.name ?? '';
  const planKey = tenantRow?.plan ?? 'pro';
  const planName = PLAN_NAMES[planKey] ?? planKey;

  const opts = {
    tenantName,
    planName,
    amountFormatted: fmtAmount(invoice.amount_paid ?? 0, invoice.currency ?? 'PLN'),
    periodStart: invoice.period_start,
    periodEnd: invoice.period_end,
    nextPaymentDate: invoice.next_payment_attempt ?? null,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoiceNumber: invoice.number ?? null,
  };

  const html = buildHtml(opts, c, lang);
  const subject = c.subject({ number: opts.invoiceNumber ?? '', planName });

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromAddr, to: [email], subject, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[invoiceEmail] Resend error:', res.status, body);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[invoiceEmail] send failed:', e.message);
    return false;
  }
}
