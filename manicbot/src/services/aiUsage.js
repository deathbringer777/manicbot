/**
 * @fileoverview Per-tenant AI cost tracking + budget enforcement.
 *
 * Plan-based monthly caps in cents (USD-equivalent). When a tenant exceeds
 * their cap, AI calls fall back to a scripted message until next month.
 *
 * Why this matters: a single tenant's runaway loop (script that sends 10k
 * messages/min to their bot) could drain the platform's Workers AI budget.
 * Caps are conservative and can be raised per-tenant via `tenant_config`.
 */

import { dbGet, dbRun } from '../utils/db.js';
import { log } from '../utils/logger.js';

const PLAN_MONTHLY_AI_CAP_CENTS = {
  start: 500,    // $5 / month
  pro:   2000,   // $20 / month
  max:   5000,   // $50 / month
};
const DEFAULT_CAP_CENTS = 500;

// Conservative estimate for Cloudflare Workers AI mixed-model pricing.
// Real cost depends on model; this is a coarse upper bound for budgeting.
const COST_PER_TOKEN_CENTS = 0.00001;

function todayDate() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function monthStart() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Check whether the tenant has budget remaining for an AI call this month.
 * @param {object} ctx - tenant ctx with .db and .tenant.plan
 * @returns {Promise<{allowed: boolean, used: number, cap: number}>}
 */
export async function checkAiBudget(ctx) {
  if (!ctx?.db || !ctx?.tenantId) return { allowed: true, used: 0, cap: 0 };
  const plan = ctx?.tenant?.plan || ctx?.plan || 'start';
  const cap = PLAN_MONTHLY_AI_CAP_CENTS[plan] ?? DEFAULT_CAP_CENTS;

  const row = await dbGet(ctx,
    `SELECT COALESCE(SUM(estimated_cost_cents), 0) AS total
     FROM ai_usage WHERE tenant_id = ? AND usage_date >= ?`,
    ctx.tenantId, monthStart(),
  );
  const used = row?.total ?? 0;
  return { allowed: used < cap, used, cap };
}

/**
 * Record AI usage after a successful call.
 * @param {object} ctx
 * @param {number} tokensIn
 * @param {number} tokensOut
 * @param {string} [model]
 */
export async function recordAiUsage(ctx, tokensIn, tokensOut, model = 'default') {
  if (!ctx?.db || !ctx?.tenantId) return;
  const tIn = Math.max(0, Number(tokensIn) || 0);
  const tOut = Math.max(0, Number(tokensOut) || 0);
  const costCents = Math.ceil((tIn + tOut) * COST_PER_TOKEN_CENTS);
  try {
    await dbRun(ctx,
      `INSERT INTO ai_usage (tenant_id, usage_date, tokens_in, tokens_out, model_calls, estimated_cost_cents)
       VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(tenant_id, usage_date) DO UPDATE SET
         tokens_in = tokens_in + excluded.tokens_in,
         tokens_out = tokens_out + excluded.tokens_out,
         model_calls = model_calls + 1,
         estimated_cost_cents = estimated_cost_cents + excluded.estimated_cost_cents`,
      ctx.tenantId, todayDate(), tIn, tOut, costCents,
    );
  } catch (e) {
    // Non-fatal — usage tracking failure shouldn't block AI replies.
    log.error('services.aiUsage', e instanceof Error ? e : new Error(String(e?.message)));
  }
}

/**
 * Fallback message when the AI budget is exhausted for the month.
 * Tenant owners can raise their cap via support.
 */
export function aiBudgetExhaustedMessage(_lang) {
  return 'Бот временно занят. Запишитесь через меню или напишите мастеру напрямую.';
}
