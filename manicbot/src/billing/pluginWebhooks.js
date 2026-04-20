/**
 * Plugin add-on webhook helpers.
 *
 * Sits on top of the main Stripe webhook dispatcher in ./webhooks.js.
 * Matches on metadata — if an invoice line or checkout session carries a
 * `plugin_slug` in its price metadata (or session metadata), we update the
 * corresponding `plugin_installations.billing_state`.
 *
 * Safe no-op when no plugin metadata is present.
 *
 * Security:
 *   - Never creates an installation row (only mutates existing).
 *   - Writes a row to plugin_events for every state change (audit trail).
 *   - Honors idempotency via the caller (webhooks.js handles event-id dedup).
 */

import { dbGet, dbRun } from '../utils/db.js';
import { nowSec } from '../utils/time.js';

async function logPluginEvent(ctx, installationId, event, detail) {
  if (!ctx?.db || !installationId) return;
  try {
    await dbRun(ctx,
      'INSERT INTO plugin_events (installation_id, event, actor_web_user_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?)',
      installationId, event, null, detail ? JSON.stringify(detail) : null, nowSec(),
    );
  } catch (e) {
    console.error('[plugin-webhook] failed to log event:', e?.message);
  }
}

async function setInstallationBillingState(ctx, tenantId, slug, newState, extra = {}) {
  if (!ctx?.db) return null;
  // Scope priority: tenant-specific install first; fall back to platform-wide.
  const conditions = [];
  const params = [slug];
  if (tenantId) {
    conditions.push('plugin_slug = ? AND tenant_id = ?');
    params.splice(1, 0, slug);
    params.push(tenantId);
  }
  // Try tenant install first.
  let row = null;
  if (tenantId) {
    row = await dbGet(ctx,
      'SELECT id FROM plugin_installations WHERE plugin_slug = ? AND tenant_id = ? LIMIT 1',
      slug, tenantId,
    );
  }
  if (!row) {
    row = await dbGet(ctx,
      'SELECT id FROM plugin_installations WHERE plugin_slug = ? AND tenant_id IS NULL LIMIT 1',
      slug,
    );
  }
  if (!row) {
    console.warn('[plugin-webhook] no installation found for slug', slug, 'tenant', tenantId);
    return null;
  }
  const assignments = ['billing_state = ?', 'updated_at = ?'];
  const values = [newState, nowSec()];
  if (extra.subscriptionItemId) {
    assignments.push('stripe_subscription_item_id = ?');
    values.push(extra.subscriptionItemId);
  }
  if (extra.paymentIntentId) {
    assignments.push('stripe_payment_intent_id = ?');
    values.push(extra.paymentIntentId);
  }
  values.push(row.id);
  await dbRun(ctx,
    `UPDATE plugin_installations SET ${assignments.join(', ')} WHERE id = ?`,
    ...values,
  );
  await logPluginEvent(ctx, row.id, 'billing_state_changed', { newState, ...extra });
  return row.id;
}

/**
 * Called on `checkout.session.completed`. Handles one-time add-on purchases.
 * Subscription-update-mode sessions are picked up by the invoice/subscription
 * handlers instead.
 */
export async function handleAddonCheckoutCompleted(ctx, session) {
  const slug = session?.metadata?.plugin_slug;
  const tenantId = session?.metadata?.tenantId ?? null;
  if (!slug) return { handled: false };
  const intent = session.payment_intent
    ? (typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id)
    : null;
  const id = await setInstallationBillingState(ctx, tenantId, slug, 'paid', { paymentIntentId: intent });
  return { handled: true, installationId: id };
}

/**
 * Called on `invoice.payment_succeeded` / `invoice.paid`.
 * Iterates line items — any line with `price.metadata.plugin_slug` flips
 * the matching installation to 'paid' + stores its subscription_item id.
 */
export async function handleAddonInvoicePaid(ctx, invoice) {
  const lines = invoice?.lines?.data ?? [];
  let touched = 0;
  for (const line of lines) {
    const slug = line?.price?.metadata?.plugin_slug;
    if (!slug) continue;
    const tenantId = line?.price?.metadata?.tenantId || invoice?.metadata?.tenantId || null;
    const subItemId = line?.subscription_item || null;
    await setInstallationBillingState(ctx, tenantId, slug, 'paid', { subscriptionItemId: subItemId });
    touched += 1;
  }
  return { handled: touched > 0, touched };
}

/**
 * Called on `invoice.payment_failed`. Flips add-on state to past_due so the
 * plugin router blocks further usage until retried.
 */
export async function handleAddonInvoiceFailed(ctx, invoice) {
  const lines = invoice?.lines?.data ?? [];
  let touched = 0;
  for (const line of lines) {
    const slug = line?.price?.metadata?.plugin_slug;
    if (!slug) continue;
    const tenantId = line?.price?.metadata?.tenantId || invoice?.metadata?.tenantId || null;
    await setInstallationBillingState(ctx, tenantId, slug, 'past_due');
    touched += 1;
  }
  return { handled: touched > 0, touched };
}

/**
 * Called on `customer.subscription.deleted` when a subscription carrying
 * plugin items is canceled entirely.
 */
export async function handleAddonSubscriptionCanceled(ctx, sub) {
  const items = sub?.items?.data ?? [];
  let touched = 0;
  for (const item of items) {
    const slug = item?.price?.metadata?.plugin_slug;
    if (!slug) continue;
    const tenantId = item?.price?.metadata?.tenantId || sub?.metadata?.tenantId || null;
    await setInstallationBillingState(ctx, tenantId, slug, 'canceled');
    touched += 1;
  }
  return { handled: touched > 0, touched };
}

// Exported for tests only.
export { setInstallationBillingState, logPluginEvent };
