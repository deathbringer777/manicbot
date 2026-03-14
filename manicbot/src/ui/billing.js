/**
 * Tenant billing menu UI. Shown to tenant owner (admin) in Management.
 */

import { send } from '../telegram.js';
import { t, escHtml } from '../utils/helpers.js';
import { getLang } from '../services/chat.js';
import { getTenantBilling } from '../billing/storage.js';
import { getStripeConfig, PLANS } from '../billing/config.js';
import { CB } from '../config.js';

function planLabel(lg, plan) {
  const key = { start: 'billing_plan_start', pro: 'billing_plan_pro', studio: 'billing_plan_studio' }[plan];
  return key ? t(lg, key) : plan;
}

function statusLabel(lg, status) {
  const key = {
    active: 'billing_status_active',
    past_due: 'billing_status_past_due',
    canceled: 'billing_status_canceled',
    inactive: 'billing_status_inactive',
  }[status];
  return key ? t(lg, key) : status;
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/**
 * Show billing menu for tenant owner. ctx must have tenantId, globalKv (env.MANICBOT), baseUrl.
 */
export async function showBillingMenu(ctx, cid, name) {
  const lg = await getLang(ctx, cid) || 'ru';
  const billing = await getTenantBilling(ctx.globalKv, ctx.tenantId);
  const stripeCfg = getStripeConfig(ctx);

  let text = `💳 <b>${t(lg, 'billing_menu')}</b>\n\n`;
  if (billing) {
    text += `${t(lg, 'billing_plan')}: ${escHtml(planLabel(lg, billing.plan))}\n`;
    text += `${t(lg, 'billing_status')}: ${escHtml(statusLabel(lg, billing.billingStatus))}\n`;
    text += `${t(lg, 'billing_next_payment')}: ${fmtDate(billing.nextPaymentDate)}\n`;
    text += `${t(lg, 'billing_period_end')}: ${fmtDate(billing.currentPeriodEnd)}\n`;
    if (billing.billingEmail) text += `${t(lg, 'billing_email')}: ${escHtml(billing.billingEmail)}\n`;
  } else {
    text += `${t(lg, 'billing_plan')}: —\n${t(lg, 'billing_status')}: —\n`;
  }

  const rows = [];
  const canCheckout = stripeCfg.ok && stripeCfg.baseUrl;
  if (canCheckout) {
    const plans = [PLANS.START, PLANS.PRO, PLANS.STUDIO].filter(p => stripeCfg.priceIds?.[p]);
    if (plans.length) {
      for (const plan of plans) {
        rows.push([{ text: `💳 ${t(lg, 'billing_subscribe')} — ${planLabel(lg, plan)}`, callback_data: CB.BILLING_SUBSCRIBE + plan }]);
      }
    }
  }
  if (billing?.stripeCustomerId && canCheckout) {
    rows.push([{ text: t(lg, 'billing_portal'), callback_data: CB.BILLING_PORTAL }]);
  }
  rows.push([{ text: t(lg, 'billing_back'), callback_data: CB.BILLING_BACK }]);

  await send(ctx, cid, text, { reply_markup: { inline_keyboard: rows } });
}
