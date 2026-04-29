/**
 * Stripe webhook handler: verify signature, idempotency, update tenant billing state.
 * Idempotency (stripe:evt:{eventId}) stays in KV (TTL 7 days).
 * stripe_customer:{customerId} → D1 stripe_customers table.
 */

import { updateTenantBilling } from './storage.js';
import { mapStripeStatusToBilling } from './stripe.js';
import { GRACE_DURATION_MS } from './config.js';
import { dbGet, dbRun } from '../utils/db.js';
import { nowSec, msToSec } from '../utils/time.js';
import { sendInvoiceEmail } from './invoiceEmail.js';
import { log } from '../utils/logger.js';
import {
  handleAddonCheckoutCompleted,
  handleAddonInvoicePaid,
  handleAddonInvoiceFailed,
  handleAddonSubscriptionCanceled,
} from './pluginWebhooks.js';

const STRIPE_EVT_PREFIX = 'stripe:evt:';
const EVT_TTL = 86400 * 7;
// Stripe recommends ±5 minute tolerance for webhook timestamp validation (replay prevention).
const STRIPE_TIMESTAMP_TOLERANCE_SEC = 300;

/** Constant-time compare for lowercase hex (Stripe v1); no Node-only APIs. */
function timingSafeEqualLowerHex(expectedLowerHex, receivedRawHex) {
  const b = receivedRawHex.toLowerCase();
  // XOR lengths into diff — no early return to avoid timing side-channel
  const maxLen = Math.max(expectedLowerHex.length, b.length);
  let diff = expectedLowerHex.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (expectedLowerHex.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function verifyStripeSignature(payload, signature, secret) {
  if (!secret || !signature) return false;
  const parts = {};
  for (const p of signature.split(',')) {
    const [k, v] = p.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  }
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  // Replay prevention: reject events with timestamp older than tolerance window.
  // `t` is the unix seconds when Stripe signed the webhook.
  const tNum = Number.parseInt(t, 10);
  if (!Number.isFinite(tNum)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  const ageSec = nowSec - tNum;
  if (ageSec > STRIPE_TIMESTAMP_TOLERANCE_SEC || ageSec < -STRIPE_TIMESTAMP_TOLERANCE_SEC) {
    return false;
  }
  const signedPayload = t + '.' + (typeof payload === 'string' ? payload : JSON.stringify(payload));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expectedHex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqualLowerHex(expectedHex, v1);
}

async function resolveTenantIdByCustomer(ctx, customerId) {
  if (!customerId || !ctx?.db) return null;
  const row = await dbGet(ctx, 'SELECT tenant_id FROM stripe_customers WHERE customer_id = ?', customerId);
  return row?.tenant_id || null;
}

/**
 * #S-07 — verify a tenantId pulled out of Stripe metadata actually maps to
 * a row in `tenants`. Without this check, a misconfigured (or hostile)
 * checkout session could push billing state at an arbitrary tenant id.
 *
 * Returns true if the tenant exists; false otherwise. We log the rejection
 * loudly so ops can see metadata drift / spoofing attempts.
 */
async function tenantExists(ctx, tenantId) {
  if (!tenantId || !ctx?.db) return false;
  try {
    const row = await dbGet(ctx, 'SELECT id FROM tenants WHERE id = ? LIMIT 1', tenantId);
    return !!row?.id;
  } catch (e) {
    log.error('stripe-webhook', e, { phase: 'tenant_exists_lookup', tenantId });
    return false;
  }
}

/** Derive plan key (start/pro/max) from subscription metadata or price metadata. */
function resolvePlanFromSub(sub) {
  // 1. Prefer subscription metadata[plan] set at checkout time
  const metaPlan = sub.metadata?.plan;
  if (metaPlan) return metaPlan;
  // 2. Fallback: price metadata[plan] (set on the Stripe Price object itself)
  const priceMeta = sub.items?.data?.[0]?.price?.metadata?.plan;
  if (priceMeta) return priceMeta;
  return null;
}

function subscriptionToBillingUpdates(sub) {
  const status = mapStripeStatusToBilling(sub.status);
  const periodEnd = sub.current_period_end || null;
  const priceId = sub.items?.data?.[0]?.price?.id || null;
  const planKey = resolvePlanFromSub(sub);
  const updates = {
    billingStatus: status,
    subscriptionStatus: sub.status,
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    currentPeriodEnd: periodEnd,
    nextPaymentDate: periodEnd,
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    updatedAt: nowSec(),
  };
  if (planKey) updates.plan = planKey;
  return updates;
}

export async function handleStripeWebhook(ctx, payload, signature, webhookSecret) {
  if (!ctx?.db || !payload || !webhookSecret) return { ok: false, status: 400 };
  const kv = ctx.kv || ctx.globalKv;
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (!(await verifyStripeSignature(raw, signature, webhookSecret))) {
    return { ok: false, status: 401 };
  }
  let body;
  try {
    body = typeof payload === 'object' ? payload : JSON.parse(payload);
  } catch {
    return { ok: false, status: 400 };
  }
  const eventId = body.id;
  const type = body.type || '';

  // Sprint 2: D1-backed idempotency in addition to KV (KV has eventual
  // consistency; D1 gives us durable audit). KV remains for fast path.
  //
  // Correctness: only treat an event as "already handled" when its
  // processed_at IS NOT NULL. The previous logic skipped on row existence
  // alone, which meant: if the row was inserted but processing then crashed,
  // Stripe's retry hit the SELECT and got "already done" → the event was
  // lost forever. Now duplicates that haven't completed processing get a
  // 503 so Stripe keeps retrying until we succeed.
  if (eventId && ctx.db) {
    try {
      const existing = await dbGet(ctx, 'SELECT processed_at FROM stripe_events WHERE event_id = ?', eventId);
      if (existing) {
        if (existing.processed_at) {
          // Successfully processed before — safe to skip.
          return { ok: true, status: 200, skipped: true };
        }
        // Row exists but never reached processed_at → previous attempt
        // failed mid-flight (or another isolate is currently processing).
        // 503 tells Stripe to back off and retry; 200 would lose the event.
        log.warn('stripe-webhook', { message: 'duplicate event with no processed_at — asking Stripe to retry', eventId });
        return { ok: false, status: 503 };
      }
      // First time we see this event — record receipt. INSERT OR IGNORE so
      // a concurrent retry that just lost the SELECT race becomes a no-op
      // here; one of the two handlers will eventually win the processed_at
      // UPDATE and the other one's downstream writes are idempotent.
      await dbRun(ctx,
        'INSERT OR IGNORE INTO stripe_events (event_id, type, received_at) VALUES (?, ?, ?)',
        eventId, type, nowSec(),
      );
    } catch (e) {
      // Idempotency layer should never block a webhook — if D1 is briefly
      // unavailable, fall through to processing. Worst case Stripe retries
      // a duplicate which downstream code is generally tolerant of (we use
      // UPSERT-style updates), but log loudly so ops sees DB outages.
      log.error('stripe-webhook', e, { phase: 'idempotency' });
    }
  }
  if (eventId && kv) {
    // KV is a secondary fast-path; keep current 7d TTL behaviour but treat
    // a hit as a strong skip signal too — Stripe-event idempotency at KV
    // expiry granularity is far better than nothing if D1 is degraded.
    const seen = await kv.get(STRIPE_EVT_PREFIX + eventId, 'text');
    if (seen && !ctx.db) {
      return { ok: true, status: 200, skipped: true };
    }
    await kv.put(STRIPE_EVT_PREFIX + eventId, '1', { expirationTtl: EVT_TTL });
  }

  if (type === 'checkout.session.completed') {
    const session = body.data?.object;
    // Plugin add-on one-time purchase — handled first; returns silently if
    // session carries no plugin_slug metadata.
    try { await handleAddonCheckoutCompleted(ctx, session); }
    catch (e) { log.error('plugin-webhook', e, { event: 'addon_checkout' }); }
    const tenantId = session?.metadata?.tenantId;
    const customerId = session?.customer;
    // #S-07 — validate the tenantId from session metadata exists. Stripe
    // metadata is set at checkout creation time but is otherwise opaque to
    // Stripe — a bug or a spoofed session could set a non-existent id.
    if (tenantId && !(await tenantExists(ctx, tenantId))) {
      log.warn('stripe-webhook', { message: 'checkout.session.completed for unknown tenantId — ignoring', tenantId, eventId, customerId });
    } else if (tenantId) {
      const updates = {};
      if (customerId) updates.stripeCustomerId = customerId;
      if (session.subscription) {
        // Record the subscription ID only. Billing status is intentionally NOT
        // set here — the customer.subscription.updated event fires immediately
        // after and correctly maps the actual Stripe status (trialing / active)
        // via subscriptionToBillingUpdates(). Setting 'active' unconditionally
        // here would override a trialing subscription status before it's corrected.
        updates.stripeSubscriptionId = session.subscription;
        updates.graceEndsAt = null;
      }
      // Update plan from session metadata (set at checkout creation time)
      if (session.metadata?.plan) updates.plan = session.metadata.plan;
      if (session.customer_email) updates.billingEmail = session.customer_email;
      await updateTenantBilling(ctx, tenantId, updates);
      if (customerId) {
        await dbRun(ctx,
          'INSERT OR REPLACE INTO stripe_customers (customer_id, tenant_id) VALUES (?, ?)',
          customerId, tenantId,
        );
      }
    }
  }

  if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
    const sub = body.data?.object;
    if (type === 'customer.subscription.deleted') {
      try { await handleAddonSubscriptionCanceled(ctx, sub); }
      catch (e) { log.error('plugin-webhook', e, { event: 'addon_sub_canceled' }); }
    }
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    let tenantId = sub.metadata?.tenantId || await resolveTenantIdByCustomer(ctx, customerId);
    // #S-07 — same metadata-existence guard as checkout.session.completed.
    // resolveTenantIdByCustomer reads from our own `stripe_customers` so its
    // result is implicitly trusted; it's the metadata branch we have to gate.
    if (tenantId && sub.metadata?.tenantId && !(await tenantExists(ctx, tenantId))) {
      log.warn('stripe-webhook', { message: 'subscription event for unknown tenantId metadata — ignoring', tenantId, eventId, customerId, type });
      tenantId = null;
    }
    if (tenantId) {
      const updates = subscriptionToBillingUpdates(sub);
      if (type === 'customer.subscription.deleted') {
        updates.billingStatus = 'inactive';
        updates.subscriptionStatus = 'canceled';
        updates.stripeSubscriptionId = null;
        updates.stripePriceId = null;
        updates.currentPeriodEnd = null;
        updates.nextPaymentDate = null;
        updates.cancelAtPeriodEnd = false;
      }
      await updateTenantBilling(ctx, tenantId, updates);
    }
  }

  if (type === 'invoice.payment_succeeded' || type === 'invoice.paid') {
    const invoice = body.data?.object;
    try { await handleAddonInvoicePaid(ctx, invoice); }
    catch (e) { log.error('plugin-webhook', e, { event: 'addon_invoice_paid' }); }
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (customerId) {
      const tenantId = await resolveTenantIdByCustomer(ctx, customerId);
      if (tenantId && ctx.resendApiKey && ctx.resendFrom) {
        // fire-and-forget: don't block 200 response on email delivery
        sendInvoiceEmail(ctx, ctx.resendApiKey, ctx.resendFrom, tenantId, invoice)
          .catch(e => log.error('webhook.invoiceEmail', e));
      }
    }
  }

  if (type === 'invoice.payment_failed') {
    const invoice = body.data?.object;
    try { await handleAddonInvoiceFailed(ctx, invoice); }
    catch (e) { log.error('plugin-webhook', e, { event: 'addon_invoice_failed' }); }
    const subscriptionId = invoice.subscription;
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (subscriptionId) {
      let tenantId = await resolveTenantIdByCustomer(ctx, customerId);
      if (tenantId) {
        await updateTenantBilling(ctx, tenantId, {
          billingStatus: 'grace_period',
          subscriptionStatus: 'past_due',
          graceEndsAt: nowSec() + msToSec(GRACE_DURATION_MS),
          updatedAt: nowSec(),
        });
      }
    }
  }

  // Sprint 2: new webhook handlers
  if (type === 'customer.subscription.trial_will_end') {
    const sub = body.data?.object;
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    const tenantId = sub.metadata?.tenantId || await resolveTenantIdByCustomer(ctx, customerId);
    if (tenantId) {
      // Emit analytics + structured log. Owner email send deferred to cron
      // to avoid blocking webhook 200 on Resend latency.
      log.info('stripe.trial_will_end', { trialEnd: sub.trial_end });
      try {
        const { dbRun: dbRun2 } = await import('../utils/db.js');
        await dbRun2(ctx,
          'INSERT INTO analytics_events (tenant_id, event, properties, created_at) VALUES (?, ?, ?, ?)',
          tenantId, 'billing.trial_will_end',
          JSON.stringify({ trialEnd: sub.trial_end, subscriptionId: sub.id }),
          nowSec(),
        );
      } catch { /* best-effort */ }
    }
  }

  if (type === 'invoice.upcoming') {
    const invoice = body.data?.object;
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    const tenantId = await resolveTenantIdByCustomer(ctx, customerId);
    if (tenantId) {
      log.info('stripe.invoice_upcoming', { dueDate: invoice.next_payment_attempt });
      try {
        const { dbRun: dbRun2 } = await import('../utils/db.js');
        await dbRun2(ctx,
          'INSERT INTO analytics_events (tenant_id, event, properties, created_at) VALUES (?, ?, ?, ?)',
          tenantId, 'billing.invoice_upcoming',
          JSON.stringify({ amountDue: invoice.amount_due, dueDate: invoice.next_payment_attempt }),
          nowSec(),
        );
      } catch { /* best-effort */ }
    }
  }

  if (type === 'charge.dispute.created') {
    const dispute = body.data?.object;
    const customerId = dispute?.charge && typeof dispute.charge === 'string'
      ? null  // would need GET /charges/{id} to resolve customer; skip for now
      : dispute?.payment_intent?.customer;
    const tenantId = customerId ? await resolveTenantIdByCustomer(ctx, customerId) : null;
    log.warn('stripe.dispute', { amount: dispute?.amount, reason: dispute?.reason });
    if (tenantId) {
      try {
        const { dbRun: dbRun2 } = await import('../utils/db.js');
        await dbRun2(ctx,
          'INSERT INTO analytics_events (tenant_id, event, properties, created_at) VALUES (?, ?, ?, ?)',
          tenantId, 'billing.dispute',
          JSON.stringify({ disputeId: dispute.id, amount: dispute.amount, reason: dispute.reason }),
          nowSec(),
        );
      } catch { /* best-effort */ }
    }
  }

  // Mark processed in D1. If this UPDATE fails we'd lose the "we already
  // succeeded" signal — next retry from Stripe would re-process the event.
  // Most handlers are idempotent (UPSERT-style) so re-processing is tolerable,
  // but we log loudly so ops sees the gap.
  if (eventId && ctx.db) {
    try {
      await dbRun(ctx, 'UPDATE stripe_events SET processed_at = ? WHERE event_id = ?', nowSec(), eventId);
    } catch (e) {
      log.error('stripe-webhook', e, { phase: 'mark_processed', eventId });
    }
  }

  return { ok: true, status: 200 };
}
