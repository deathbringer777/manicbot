/**
 * @fileoverview WhatsApp template message management.
 *
 * WhatsApp requires pre-approved message templates for messages sent outside
 * the 24-hour customer service window. Templates are approved via Meta Business Manager.
 *
 * Predefined template names used by ManicBot:
 *  - appointment_reminder  (24h + 2h reminders via cron)
 *  - appointment_confirmed (booking confirmation)
 *  - booking_welcome       (first-ever message to a new user)
 */

import { dbAll, dbRun } from '../utils/db.js';
import { nowSec } from '../utils/time.js';
import { PLAN_LIMITS } from '../billing/config.js';
import { log } from '../utils/logger.js';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

/**
 * Send a WhatsApp template message.
 *
 * @param {string} phoneNumberId - The sender phone number ID
 * @param {string} token         - Page access token
 * @param {string} to            - Recipient phone number
 * @param {string} templateName  - Pre-approved template name
 * @param {string} languageCode  - e.g. 'en_US', 'ru', 'pl'
 * @param {Array<{type:'text'|'currency'|'date_time', text?: string}>} [components] - Template parameters
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function sendTemplateMessage(phoneNumberId, token, to, templateName, languageCode = 'en_US', components = []) {
  if (!phoneNumberId || !token) return { ok: false, error: 'not_configured' };
  try {
    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    };
    const res = await fetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      log.error('channels.whatsappTemplates', new Error(`send ${templateName} failed ${res.status}`), { status: res.status });
      return { ok: false, error: data.error?.message ?? 'unknown' };
    }
    return { ok: true, data };
  } catch (e) {
    log.error('channels.whatsappTemplates', e instanceof Error ? e : new Error(String(e.message)));
    return { ok: false, error: e.message };
  }
}

/**
 * Count how many templates this tenant has sent this calendar month.
 *
 * @param {{ db: D1Database, tenantId: string }} ctx
 * @returns {Promise<number>}
 */
export async function getTemplateUsageThisMonth(ctx) {
  if (!ctx?.db || !ctx.tenantId) return 0;
  const w = new Date();
  const monthStart = Math.floor(new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), 1)).getTime() / 1000);
  const rows = await dbAll(ctx,
    'SELECT COUNT(*) as cnt FROM template_usage WHERE tenant_id = ? AND sent_at >= ?',
    ctx.tenantId, monthStart,
  );
  return rows[0]?.cnt ?? 0;
}

/**
 * Check if the tenant can send another template message this month.
 *
 * @param {{ db: D1Database, tenantId: string, tenant: object }} ctx
 * @returns {Promise<boolean>}
 */
export async function canSendTemplate(ctx) {
  if (!ctx.tenant) return true; // legacy mode — no restrictions
  const plan = ctx.tenant.plan ?? 'start';
  const limit = (PLAN_LIMITS[plan] ?? PLAN_LIMITS.start).wa_templates_monthly ?? 0;
  if (limit === 0) return false;
  const usage = await getTemplateUsageThisMonth(ctx);
  return usage < limit;
}

/**
 * Record a template send in the template_usage table (for quota tracking).
 *
 * @param {{ db: D1Database, tenantId: string }} ctx
 * @param {string} templateName
 * @param {number} [costUsd=0]
 */
export async function trackTemplateUsage(ctx, templateName, costUsd = 0) {
  if (!ctx?.db || !ctx.tenantId) return;
  await dbRun(ctx,
    'INSERT INTO template_usage (tenant_id, channel_type, template_name, sent_at, cost_usd) VALUES (?, ?, ?, ?, ?)',
    ctx.tenantId, 'whatsapp', templateName, nowSec(), costUsd,
  );
}

/**
 * Helper: build component parameters for appointment reminder templates.
 * Each template must be configured in Meta Business Manager first.
 *
 * @param {{ svc: string, dt: string, addr: string }} vars
 * @returns {object[]} WA template components array
 */
export function buildReminderComponents(vars) {
  return [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: vars.svc ?? '' },
        { type: 'text', text: vars.dt ?? '' },
        { type: 'text', text: vars.addr ?? '' },
      ],
    },
  ];
}
