/**
 * @fileoverview Tenant-scoped analytics event recorder (Sprint 4).
 *
 * Thin wrapper over `INSERT INTO analytics_events`. All call sites are
 * fire-and-forget — analytics failures MUST NOT break user-visible flows.
 *
 * Canonical event names (keep stable — dashboards grep on these):
 *   booking.created, booking.cancelled, booking.completed, booking.no_show
 *   promo.redeemed, promo.returning_candidate
 *   message.sent, ai.call
 *   onboarding.step_completed
 *   dashboard.tab_view
 *   billing.trial_will_end, billing.invoice_upcoming, billing.dispute
 *   post_visit.prompt_due
 */

import { dbRun } from './db.js';
import { nowSec } from './time.js';
import { log } from './logger.js';

/**
 * Record one analytics event.
 * @param {{ db?: D1Database, tenantId?: string }} ctx
 * @param {string} event - canonical event name, e.g. 'booking.created'
 * @param {object} [properties] - small JSON-serializable object
 * @param {{ userId?: string|number }} [opts]
 */
export async function recordEvent(ctx, event, properties = {}, opts = {}) {
  if (!ctx?.db || !event) return;
  try {
    await dbRun(ctx, `
      INSERT INTO analytics_events (tenant_id, user_id, event, properties, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
      ctx.tenantId || null,
      opts.userId != null ? String(opts.userId) : null,
      event,
      JSON.stringify(properties || {}).slice(0, 1000),
      nowSec(),
    );
  } catch (e) {
    // Non-fatal — analytics never block the hot path.
    log.error('utils.analytics', e instanceof Error ? e : new Error(String(e?.message)));
  }
}
