/**
 * Worker-side marketing-automation dispatcher.
 *
 * Event-driven triggers (appointment.done, appointment.no_show_master,
 * birthday, etc.) call `fireAutomationForEvent(ctx, eventType, opts)`.
 * The helper:
 *   1. SELECTs enabled `marketing_automations` rows where
 *      `trigger_type = eventType` AND tenant_id matches (or NULL =
 *      platform-default).
 *   2. For each row, parses `steps_json` (must be a JSON array; first
 *      step is the "send" step we execute — multi-step funnels are a
 *      future extension).
 *   3. Resolves the single `marketing_contacts` row for the triggering
 *      user (matched on `linked_user_chat_id = ?`). If no row exists,
 *      the automation is a no-op for that user (no consent path = no
 *      send). This is intentional — automations don't create marketing
 *      contacts on the fly; that's the job of admin-app `syncMarketingContact`.
 *   4. Creates an ad-hoc `marketing_campaigns` row with `tenant_id`,
 *      `name = '[auto] <automation_name>'`, `template_id`, `channel`.
 *   5. Calls `runCampaignSend(..., { singleContactId })` — the sender's
 *      new single-recipient mode (Phase 2C).
 *
 * Concurrency / idempotency:
 *   - Caller (e.g. `appointmentAutomations.js`) should call this AT MOST
 *     ONCE per event (the upstream dispatcher already de-dupes via
 *     `dispatchAppointmentAutomation` — never invoked twice for the same
 *     status flip on the same apt row).
 *   - Within this helper, ad-hoc campaign ids are unique per call
 *     (timestamp + random suffix), so a stray re-fire from a retry
 *     creates a new campaign rather than re-running the previous one.
 *     Audit trail in `marketing_sends` carries both the campaign id and
 *     the original contact id.
 *
 * Returns `{ fired, errors }` — `fired` is the count of automation rows
 * that actually generated at least one send (skipped rows where the
 * contact didn't exist / wasn't consented don't count).
 *
 * NB: tenant_id-NULL automations are PLATFORM templates — they fire for
 * every tenant. Tenant-specific rows shadow the platform default with
 * the same trigger_type (so a salon can override the platform copy).
 */

import { dbAll, dbGet, dbRun } from '../../utils/db.js';
import { log } from '../../utils/logger.js';
import { runCampaignSend } from './sender.js';

function rid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Parse `steps_json` and extract the first send-step's templateId + channel.
 * Returns null on malformed JSON or empty array — the helper skips that automation.
 */
export function parseFirstSendStep(stepsJson) {
  if (!stepsJson || typeof stepsJson !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(stepsJson);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const step = parsed[0];
  if (!step || typeof step !== 'object') return null;
  const templateId = typeof step.templateId === 'string' ? step.templateId : null;
  if (!templateId) return null;
  const channel = step.channel === 'sms' || step.channel === 'whatsapp' ? step.channel : 'email';
  const segmentId = typeof step.segmentId === 'string' ? step.segmentId : null;
  return { templateId, channel, segmentId };
}

/**
 * Fire automations matching an event for a specific user (single-recipient).
 *
 * Required `ctx.tenantId` and `ctx.db?.prepare` (D1 binding).
 * `opts.chatId` — the Telegram chat id of the triggering user. Used to
 *   look up the matching `marketing_contacts` row via `linked_user_chat_id`.
 * `opts.now` — UNIX seconds; defaults to current time. Lets tests pin.
 */
export async function fireAutomationForEvent(ctx, eventType, opts = {}) {
  const result = { fired: 0, skipped: 0, errors: 0, automations: 0 };
  if (!ctx?.tenantId || !ctx?.db?.prepare) return result;
  if (!eventType || typeof eventType !== 'string') return result;

  const tenantId = ctx.tenantId;
  const chatId = opts.chatId ?? null;

  // 1) Find enabled automations matching this event type for this tenant
  //    (or platform-wide tenant_id=NULL).
  const rows = await dbAll(ctx,
    `SELECT id, tenant_id, name, steps_json FROM marketing_automations
     WHERE trigger_type = ? AND enabled = 1 AND (tenant_id = ? OR tenant_id IS NULL)`,
    eventType, tenantId,
  ).catch((e) => {
    log.error('marketing.automations', e instanceof Error ? e : new Error(String(e?.message)),
      { phase: 'select_automations', eventType, tenantId });
    return [];
  });
  result.automations = rows.length;
  if (rows.length === 0) return result;

  // 2) Look up the marketing_contact for this user. If they don't have
  //    one, the automation can't deliver — skip silently. (The salon's
  //    `clients` router calls `syncMarketingContact` on add/update, so
  //    most active clients will have a row.)
  let contact = null;
  if (chatId != null) {
    contact = await dbGet(ctx,
      `SELECT id FROM marketing_contacts
       WHERE tenant_id = ? AND linked_user_chat_id = ? AND unsubscribed = 0
       LIMIT 1`,
      tenantId, chatId,
    ).catch(() => null);
  }
  if (!contact) {
    result.skipped = rows.length;
    return result;
  }

  // 3) For each matching automation, create an ad-hoc campaign and fire.
  for (const auto of rows) {
    const step = parseFirstSendStep(auto.steps_json);
    if (!step) {
      result.errors += 1;
      log.warn('marketing.automations', {
        action: 'invalid_steps_json',
        automationId: auto.id,
        eventType,
      });
      continue;
    }

    const campaignId = rid('cmp_auto');
    const t = opts.now ?? nowSec();
    try {
      await dbRun(ctx,
        `INSERT INTO marketing_campaigns
         (id, tenant_id, name, channel, segment_id, template_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
        campaignId,
        // Always tenant-scoped — even platform-default automations write the
        // campaign under the tenant that triggered the event so analytics +
        // /system/marketing/sends correctly attribute the send.
        tenantId,
        `[auto] ${auto.name}`.slice(0, 120),
        step.channel,
        step.segmentId,
        step.templateId,
        t, t,
      );
    } catch (e) {
      result.errors += 1;
      log.error('marketing.automations', e instanceof Error ? e : new Error(String(e?.message)),
        { phase: 'insert_campaign', automationId: auto.id, eventType });
      continue;
    }

    try {
      const r = await runCampaignSend(ctx, tenantId, campaignId, {
        singleContactId: contact.id,
      });
      if (r.ok && r.sent > 0) {
        result.fired += 1;
      } else {
        result.skipped += 1;
      }
    } catch (e) {
      result.errors += 1;
      log.error('marketing.automations', e instanceof Error ? e : new Error(String(e?.message)),
        { phase: 'run_campaign', automationId: auto.id, campaignId, eventType });
    }
  }

  return result;
}
