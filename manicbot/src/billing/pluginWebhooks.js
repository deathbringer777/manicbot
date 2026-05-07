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
import { log } from '../utils/logger.js';

async function logPluginEvent(ctx, installationId, event, detail) {
  if (!ctx?.db || !installationId) return;
  try {
    await dbRun(ctx,
      'INSERT INTO plugin_events (installation_id, event, actor_web_user_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?)',
      installationId, event, null, detail ? JSON.stringify(detail) : null, nowSec(),
    );
  } catch (e) {
    log.error('billing.pluginWebhooks', e instanceof Error ? e : new Error(String(e?.message)));
  }
}

/**
 * Resolve the authoritative tenantId for a Stripe webhook event.
 *
 * #P1-7 — never trust webhook metadata without cross-checking. The Stripe
 * customer is the strongest identity we have; we link customer_id → tenant_id
 * via the stripe_customers table at checkout creation time. If the webhook
 * metadata names a different tenant than the customer's owner, that is a hard
 * tampering signal — log and refuse the mutation.
 *
 * Returns the verified tenantId, or null if the addon should not be applied.
 */
async function resolveAddonTenant(ctx, metaTenantId, customerId, slug) {
  if (!ctx?.db) return metaTenantId ?? null;
  if (!customerId) {
    // Caller has no Stripe customer to anchor against — fall back to metadata
    // (which is at least set by us at checkout creation time) but only if the
    // tenant exists in our own table. Otherwise we'd accept arbitrary ids.
    if (!metaTenantId) return null;
    const t = await dbGet(ctx, 'SELECT id FROM tenants WHERE id = ? LIMIT 1', metaTenantId);
    return t?.id ?? null;
  }
  const owner = await dbGet(ctx,
    'SELECT tenant_id FROM stripe_customers WHERE customer_id = ?', customerId);
  if (owner?.tenant_id) {
    if (metaTenantId && owner.tenant_id !== metaTenantId) {
      log.error('billing.pluginWebhooks',
        new Error('plugin webhook metadata.tenantId does not match stripe_customers.tenant_id — refusing'),
        { slug, customerId, metaTenantId, ownerTenantId: owner.tenant_id });
      return null;
    }
    return owner.tenant_id;
  }
  // Customer not in stripe_customers (orphan). If metadata is provided, only
  // accept it when it maps to a real tenant; otherwise no-op.
  if (metaTenantId) {
    const t = await dbGet(ctx, 'SELECT id FROM tenants WHERE id = ? LIMIT 1', metaTenantId);
    return t?.id ?? null;
  }
  return null;
}

async function setInstallationBillingState(ctx, metaTenantId, customerId, slug, newState, extra = {}) {
  if (!ctx?.db) return null;
  const tenantId = await resolveAddonTenant(ctx, metaTenantId, customerId, slug);
  // No verified tenant ⇒ silently no-op rather than mutate a guessed row.
  // Keep platform-wide installs working: they explicitly carry tenantId === null.
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
    log.warn('billing.pluginWebhooks', { message: 'no installation found', slug, tenantId });
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
  const metaTenantId = session?.metadata?.tenantId ?? null;
  const customerId = typeof session?.customer === 'string'
    ? session.customer
    : session?.customer?.id ?? null;
  if (!slug) return { handled: false };
  const intent = session.payment_intent
    ? (typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id)
    : null;
  const id = await setInstallationBillingState(ctx, metaTenantId, customerId, slug, 'paid', { paymentIntentId: intent });
  return { handled: id != null, installationId: id };
}

/**
 * Called on `invoice.payment_succeeded` / `invoice.paid`.
 * Iterates line items — any line with `price.metadata.plugin_slug` flips
 * the matching installation to 'paid' + stores its subscription_item id.
 */
export async function handleAddonInvoicePaid(ctx, invoice) {
  const lines = invoice?.lines?.data ?? [];
  const customerId = typeof invoice?.customer === 'string'
    ? invoice.customer
    : invoice?.customer?.id ?? null;
  let touched = 0;
  for (const line of lines) {
    const slug = line?.price?.metadata?.plugin_slug;
    if (!slug) continue;
    const metaTenantId = line?.price?.metadata?.tenantId || invoice?.metadata?.tenantId || null;
    const subItemId = line?.subscription_item || null;
    const id = await setInstallationBillingState(ctx, metaTenantId, customerId, slug, 'paid', { subscriptionItemId: subItemId });
    if (id) touched += 1;
  }
  return { handled: touched > 0, touched };
}

/**
 * Called on `invoice.payment_failed`. Flips add-on state to past_due so the
 * plugin router blocks further usage until retried.
 */
export async function handleAddonInvoiceFailed(ctx, invoice) {
  const lines = invoice?.lines?.data ?? [];
  const customerId = typeof invoice?.customer === 'string'
    ? invoice.customer
    : invoice?.customer?.id ?? null;
  let touched = 0;
  for (const line of lines) {
    const slug = line?.price?.metadata?.plugin_slug;
    if (!slug) continue;
    const metaTenantId = line?.price?.metadata?.tenantId || invoice?.metadata?.tenantId || null;
    const id = await setInstallationBillingState(ctx, metaTenantId, customerId, slug, 'past_due');
    if (id) touched += 1;
  }
  return { handled: touched > 0, touched };
}

/**
 * Called on `customer.subscription.deleted` when a subscription carrying
 * plugin items is canceled entirely.
 */
export async function handleAddonSubscriptionCanceled(ctx, sub) {
  const items = sub?.items?.data ?? [];
  const customerId = typeof sub?.customer === 'string'
    ? sub.customer
    : sub?.customer?.id ?? null;
  let touched = 0;
  for (const item of items) {
    const slug = item?.price?.metadata?.plugin_slug;
    if (!slug) continue;
    const metaTenantId = item?.price?.metadata?.tenantId || sub?.metadata?.tenantId || null;
    const id = await setInstallationBillingState(ctx, metaTenantId, customerId, slug, 'canceled');
    if (id) touched += 1;
  }
  return { handled: touched > 0, touched };
}

// Exported for tests only.
export { setInstallationBillingState, logPluginEvent, resolveAddonTenant };
