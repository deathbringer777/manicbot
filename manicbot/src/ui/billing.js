/**
 * Tenant billing menu UI. Shown to tenant owner (admin) in Management.
 */

import { send } from '../telegram.js';
import { t, escHtml, fill } from '../utils/helpers.js';
import { getLang } from '../services/chat.js';
import { getTenantBilling } from '../billing/storage.js';
import { getStripeConfig, PLANS } from '../billing/config.js';
import { graceRemainingDays, trialRemainingDays } from '../billing/features.js';
import { CB } from '../config.js';

function planLabel(lg, plan) {
  const key = { start: 'billing_plan_start', pro: 'billing_plan_pro', studio: 'billing_plan_studio' }[plan];
  return key ? t(lg, key) : plan;
}

function statusLabel(lg, status) {
  const key = {
    active:       'billing_status_active',
    trialing:     'billing_status_trialing',
    grace_period: 'billing_status_grace_period',
    past_due:     'billing_status_past_due',
    canceled:     'billing_status_canceled',
    inactive:     'billing_status_inactive',
  }[status];
  return key ? t(lg, key) : status;
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function planButtonRows(lg, stripeCfg) {
  const rows = [];
  const plans = [PLANS.START, PLANS.PRO, PLANS.STUDIO].filter(p => stripeCfg.priceIds?.[p]);
  const labels = { start: 'Start — 45 zł', pro: 'Pro — 60 zł ⭐', studio: 'Studio — 90 zł' };
  for (const plan of plans) {
    rows.push([{ text: `💳 ${labels[plan] || planLabel(lg, plan)}`, callback_data: CB.BILLING_SUBSCRIBE + plan }]);
  }
  return rows;
}

/**
 * Show billing menu for tenant owner. ctx must have tenantId, globalKv (env.MANICBOT), baseUrl.
 */
export async function showBillingMenu(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const billing = await getTenantBilling(ctx.globalKv, ctx.tenantId);
  const stripeCfg = getStripeConfig(ctx);

  let text = `💳 <b>${t(lg, 'billing_menu')}</b>\n\n`;
  if (billing) {
    text += `${t(lg, 'billing_plan')}: <b>${escHtml(planLabel(lg, billing.plan))}</b>\n`;
    text += `${t(lg, 'billing_status')}: <b>${escHtml(statusLabel(lg, billing.billingStatus))}</b>\n`;

    // Trial info
    if (billing.billingStatus === 'trialing' && billing.trialEndsAt) {
      const days = Math.max(0, Math.ceil((billing.trialEndsAt - Date.now()) / 86400000));
      text += `${t(lg, 'billing_trial_ends')}: ${fmtDate(billing.trialEndsAt)}\n`;
      text += `\n${fill(t(lg, 'billing_trial_info'), { days: String(days) })}\n`;
    }

    // Grace period warning
    if (billing.billingStatus === 'grace_period' && billing.graceEndsAt) {
      const days = Math.max(0, Math.ceil((billing.graceEndsAt - Date.now()) / 86400000));
      text += `${t(lg, 'billing_grace_ends')}: ${fmtDate(billing.graceEndsAt)}\n`;
      text += `\n${fill(t(lg, 'billing_grace_warning'), { days: String(days) })}\n`;
    }

    if (billing.nextPaymentDate) text += `${t(lg, 'billing_next_payment')}: ${fmtDate(billing.nextPaymentDate)}\n`;
    if (billing.currentPeriodEnd) text += `${t(lg, 'billing_period_end')}: ${fmtDate(billing.currentPeriodEnd)}\n`;
    if (billing.billingEmail) text += `${t(lg, 'billing_email')}: ${escHtml(billing.billingEmail)}\n`;
  } else {
    text += `${t(lg, 'billing_plan')}: —\n${t(lg, 'billing_status')}: —\n`;
  }

  const rows = [];
  const canCheckout = stripeCfg.ok && stripeCfg.baseUrl;
  if (canCheckout) {
    rows.push(...planButtonRows(lg, stripeCfg));
  }
  if (billing?.stripeCustomerId && canCheckout) {
    rows.push([{ text: t(lg, 'billing_portal'), callback_data: CB.BILLING_PORTAL }]);
  }
  rows.push([{ text: t(lg, 'billing_back'), callback_data: CB.BILLING_BACK }]);

  await send(ctx, cid, text, { reply_markup: { inline_keyboard: rows } });
}

/**
 * Show "access suspended" message with plan selection buttons.
 * Used when tenant billingStatus is inactive or canceled.
 */
export async function showInactiveMessage(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const stripeCfg = getStripeConfig(ctx);
  const text = t(lg, 'billing_inactive_msg');
  const rows = [];
  if (stripeCfg.ok && stripeCfg.baseUrl) {
    rows.push(...planButtonRows(lg, stripeCfg));
  }
  rows.push([{ text: t(lg, 'billing_back'), callback_data: CB.BILLING_BACK }]);
  await send(ctx, cid, text, { reply_markup: { inline_keyboard: rows } });
}
