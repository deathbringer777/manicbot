/**
 * Stripe webhook handler: verify signature, idempotency, update tenant billing state.
 * Idempotency (stripe:evt:{eventId}) stays in KV (TTL 7 days).
 * stripe_customer:{customerId} → D1 stripe_customers table.
 */

import { updateTenantBilling, setSecondarySalonsBillingStatus } from './storage.js';
import { mapStripeStatusToBilling } from './stripe.js';
import { GRACE_DURATION_MS, priceIdToPlan } from './config.js';
import { dbGet, dbRun } from '../utils/db.js';
import { nowSec, msToSec } from '../utils/time.js';
import { sendInvoiceEmail } from './invoiceEmail.js';
import {
  sendPaymentFailedEmail,
  sendPlanUpgradeEmail,
  isPlanUpgrade,
} from './notificationEmails.js';
import { log } from '../utils/logger.js';
import {
  handleAddonCheckoutCompleted,
  handleAddonInvoicePaid,
  handleAddonInvoiceFailed,
  handleAddonSubscriptionCanceled,
} from './pluginWebhooks.js';
import {
  handleReferralInvoicePaid,
  handleReferralSubscriptionDeleted,
} from './referralWebhooks.js';
import { notifyTenantOwner } from '../services/userNotify.js';
import { fireReactiveForTenant } from '../services/reactiveMessaging.js';
import { sendCapiEvent } from '../marketing/metaCapi.js';

const CAPI_SOURCE_URL = 'https://manicbot.com';

// #P1-5 (relax.md §5) — plan tier order is the single source of truth for
// upgrade detection. Mirrored verbatim by `notificationEmails.PLAN_ORDER`.
const PLAN_ORDER = ['start', 'pro', 'max'];  

const STRIPE_EVT_PREFIX = 'stripe:evt:';
const EVT_TTL = 86400 * 7;
// #P0-2 — replay tolerance window. Stripe's published guidance is ±300s but
// we tighten to ±120s as defence-in-depth. Combined with the D1 event-id
// dedup (stripe_events.processed_at), this leaves an attacker at most a
// 4-minute window to replay a captured signed payload before the timestamp
// check rejects it. Real webhook clocks are usually within ±10s of UTC.
const STRIPE_TIMESTAMP_TOLERANCE_SEC = 120;

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

/**
 * Resolve the tenant id behind a Stripe customer id.
 *
 * #S2-3 — two write paths populate the customer→tenant mapping and they do
 * NOT overlap:
 *   - the Worker `checkout.session.completed` handler writes `stripe_customers`
 *   - the admin-app checkout writes `tenants.stripe_customer_id` directly and
 *     never touches `stripe_customers`.
 * A customer-keyed event (invoice.paid / invoice.payment_failed /
 * subscription.updated) that arrives BEFORE any checkout.session.completed
 * therefore used to silently no-op for admin-app-provisioned tenants.
 *
 * We first try `stripe_customers` (fast, indexed) and fall back to
 * `tenants.stripe_customer_id`. On a fallback hit we self-heal the
 * `stripe_customers` row so subsequent lookups take the fast path and the two
 * mappings converge.
 */
async function resolveTenantIdByCustomer(ctx, customerId) {
  if (!customerId || !ctx?.db) return null;
  const row = await dbGet(ctx, 'SELECT tenant_id FROM stripe_customers WHERE customer_id = ?', customerId);
  if (row?.tenant_id) return row.tenant_id;

  // Fallback: admin-app checkout stamps tenants.stripe_customer_id directly.
  const tRow = await dbGet(ctx, 'SELECT id FROM tenants WHERE stripe_customer_id = ? LIMIT 1', customerId);
  if (!tRow?.id) return null;

  // Self-heal: backfill stripe_customers so the next lookup is the fast path.
  // INSERT OR IGNORE — a concurrent isolate that already healed it is a no-op.
  try {
    await dbRun(ctx,
      'INSERT OR IGNORE INTO stripe_customers (customer_id, tenant_id) VALUES (?, ?)',
      customerId, tRow.id,
    );
  } catch (e) {
    log.warn('stripe-webhook', { message: 'stripe_customers self-heal failed', error: e?.message });
  }
  return tRow.id;
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

/**
 * Derive plan key (start/pro/max) for a subscription.
 *
 * STRIPE-01: the live price ID is the AUTHORITATIVE signal. A Customer-Portal
 * plan change swaps the subscription's price but leaves the original checkout's
 * metadata.plan stale, so resolving from metadata alone desynced tenants.plan.
 * Map priceId -> plan via the configured STRIPE_PRICE_* ids first; only fall
 * back to subscription/price metadata when the price is unconfigured (cfg
 * unavailable, or a legacy/one-off price).
 */
function resolvePlanFromSub(sub, cfg) {
  const priceId = sub.items?.data?.[0]?.price?.id;
  const planByPrice = priceIdToPlan(cfg, priceId);
  if (planByPrice) return planByPrice;
  const metaPlan = sub.metadata?.plan;
  if (metaPlan) return metaPlan;
  const priceMeta = sub.items?.data?.[0]?.price?.metadata?.plan;
  if (priceMeta) return priceMeta;
  return null;
}

function subscriptionToBillingUpdates(sub, cfg) {
  const status = mapStripeStatusToBilling(sub.status);
  const periodEnd = sub.current_period_end || null;
  const priceId = sub.items?.data?.[0]?.price?.id || null;
  const planKey = resolvePlanFromSub(sub, cfg);
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
  // Stripe `pause_collection` does NOT change sub.status (it stays 'active'), so
  // reflect a paused subscription as our own 'paused' billing_status here — both
  // to pause service via feature-gating and so a subsequent subscription.updated
  // doesn't reset an intentionally-paused tenant back to 'active'.
  if (sub.pause_collection) {
    updates.billingStatus = 'paused';
  }
  if (planKey) updates.plan = planKey;
  return updates;
}

export async function handleStripeWebhook(ctx, payload, signature, webhookSecret, cfg = null) {
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
      // here.
      //
      // #S2-5 — the INSERT is the authoritative claim, not the SELECT. Under
      // concurrent re-delivery BOTH isolates can pass the SELECT (each sees no
      // row) and then race the INSERT. Exactly one wins (changes=1); the other
      // gets changes=0. The loser MUST back off with a 503 — otherwise the
      // handler body (e.g. the plan_upgrade email) runs twice. The 503 makes
      // Stripe retry, by which point the winner has set processed_at and the
      // retry short-circuits at the SELECT above.
      const insertRes = await dbRun(ctx,
        'INSERT OR IGNORE INTO stripe_events (event_id, type, received_at) VALUES (?, ?, ?)',
        eventId, type, nowSec(),
      );
      if (insertRes?.meta?.changes === 0) {
        log.warn('stripe-webhook', { message: 'lost INSERT race for event id — asking Stripe to retry', eventId });
        return { ok: false, status: 503 };
      }
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
    const tenantId = session?.metadata?.tenantId;
    const customerId = session?.customer;
    // #S-07 / #P0-2 — validate the tenantId from session metadata exists
    // BEFORE running plugin handlers. The previous order let an addon flip
    // billing_state for an unrelated tenant if the metadata was spoofed.
    // Stripe metadata is set at checkout creation time but is otherwise
    // opaque to Stripe — a bug or a hostile session could set a stray id.
    const validTenant = tenantId ? await tenantExists(ctx, tenantId) : false;
    if (tenantId && !validTenant) {
      log.warn('stripe-webhook', { message: 'checkout.session.completed for unknown tenantId — ignoring', tenantId, eventId, customerId });
    } else {
      // Plugin add-on one-time purchase — runs only after tenant validation
      // (or when the session carries no tenantId metadata, in which case the
      // addon handler will resolve via stripe_customers — see #P1-7).
      try { await handleAddonCheckoutCompleted(ctx, session); }
      catch (e) { log.error('plugin-webhook', e, { event: 'addon_checkout' }); }
    }
    if (tenantId && validTenant) {
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
      // Meta CAPI: server-side CompleteRegistration when a salon completes the
      // SUBSCRIPTION checkout (trial or paid) — the addon-purchase path (no
      // session.subscription) is intentionally excluded. Carries the owner email
      // for ad-match. Best-effort + feature-flagged: a CAPI failure must never
      // affect billing state. event_id is stable per checkout for browser↔server dedup.
      if (session.subscription) {
        try {
          const email = session.customer_email
            || (await dbGet(ctx, 'SELECT billing_email FROM tenants WHERE id = ?', tenantId))?.billing_email;
          await sendCapiEvent(ctx, {
            eventName: 'CompleteRegistration',
            eventId: `reg_${session.id}`,
            email,
            eventSourceUrl: CAPI_SOURCE_URL,
          });
        } catch (e) {
          log.warn('marketing.capi', { event: 'checkout_completed', error: e?.message });
        }
      }
    }
  }

  if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
    const sub = body.data?.object;
    if (type === 'customer.subscription.deleted') {
      try { await handleAddonSubscriptionCanceled(ctx, sub); }
      catch (e) { log.error('plugin-webhook', e, { event: 'addon_sub_canceled' }); }
      try { await handleReferralSubscriptionDeleted(ctx, sub); }
      catch (e) { log.error('referral-webhook', e instanceof Error ? e : new Error(String(e?.message)), { event: 'referral_sub_deleted' }); }
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
      const updates = subscriptionToBillingUpdates(sub, cfg);
      if (type === 'customer.subscription.deleted') {
        updates.billingStatus = 'inactive';
        updates.subscriptionStatus = 'canceled';
        updates.stripeSubscriptionId = null;
        updates.stripePriceId = null;
        updates.currentPeriodEnd = null;
        updates.nextPaymentDate = null;
        updates.cancelAtPeriodEnd = false;
      }

      // #P1-5 (relax.md §5) — detect plan-tier UPGRADES on subscription.updated.
      // We read the existing tenant.plan BEFORE writing the new value so we
      // can fire `plan_upgrade` exactly once on the transition. Downgrades
      // and lateral moves never email; `isPlanUpgrade` enforces strict-up.
      let oldPlanForUpgrade = null;
      let newPlanForUpgrade = null;
      if (type === 'customer.subscription.updated' && updates.plan) {
        try {
          const current = await dbGet(ctx, 'SELECT plan, pending_plan FROM tenants WHERE id = ?', tenantId);
          oldPlanForUpgrade = current?.plan ?? null;
          newPlanForUpgrade = updates.plan;
          // A scheduled downgrade has landed (the live plan now equals the
          // pending target) → clear the denormalized pending-downgrade fields so
          // the dashboard stops showing "downgrades on <date>".
          if (current?.pending_plan && updates.plan === current.pending_plan) {
            updates.pendingPlan = null;
            updates.pendingPriceId = null;
            updates.pendingPlanEffectiveAt = null;
            updates.pendingScheduleId = null;
          }
        } catch { /* best-effort */ }
      }

      await updateTenantBilling(ctx, tenantId, updates);

      // Multi-salon cascade (migration 0109): secondary salons are billed under
      // this parent's MAX subscription. Mirror the parent's effective MAX
      // entitlement onto them — freeze when it leaves MAX (or its sub ends),
      // restore when it returns. No-op for tenants without secondaries.
      try {
        const parent = await dbGet(ctx, 'SELECT plan, billing_status FROM tenants WHERE id = ?', tenantId);
        const entitled = !!parent && parent.plan === 'max' &&
          (parent.billing_status === 'active' || parent.billing_status === 'trialing');
        await setSecondarySalonsBillingStatus(ctx, tenantId, entitled ? 'active' : 'inactive');
      } catch (e) {
        log.error('webhook.multiSalonCascade', e instanceof Error ? e : new Error(String(e)), { tenantId });
      }

      if (
        type === 'customer.subscription.updated' &&
        ctx.resendApiKey && ctx.resendFrom &&
        isPlanUpgrade(oldPlanForUpgrade, newPlanForUpgrade)
      ) {
        // fire-and-forget: never block Stripe 200 on email delivery
        sendPlanUpgradeEmail(ctx, ctx.resendApiKey, ctx.resendFrom, tenantId, oldPlanForUpgrade, newPlanForUpgrade)
          .catch(e => log.error('webhook.planUpgradeEmail', e));
      }

      // Messaging service: reactive plan-changed / subscription-expired news
      // messages (flag-gated, staged until MESSAGING_SEND_ENABLED). The tenant
      // row already carries the new plan (updateTenantBilling ran above); pass
      // {plan} explicitly so the message names the new tier.
      if (type === 'customer.subscription.deleted') {
        fireReactiveForTenant(ctx, tenantId, {
          kind: 'sys_subscription_expired',
          occurrenceKey: `sub_expired:${sub.id}`,
        }).catch((e) => log.warn('webhooks', { action: 'reactive_sub_expired', error: e?.message }));
      } else if (updates.plan && oldPlanForUpgrade && updates.plan !== oldPlanForUpgrade) {
        fireReactiveForTenant(ctx, tenantId, {
          kind: 'sys_plan_changed',
          occurrenceKey: `plan_changed:${sub.id}:${updates.plan}`,
          vars: { plan: updates.plan },
        }).catch((e) => log.warn('webhooks', { action: 'reactive_plan_changed', error: e?.message }));
      }
    }
  }

  if (type === 'invoice.payment_succeeded' || type === 'invoice.paid') {
    const invoice = body.data?.object;
    try { await handleAddonInvoicePaid(ctx, invoice); }
    catch (e) { log.error('plugin-webhook', e, { event: 'addon_invoice_paid' }); }
    // Referral program: fire ONLY the reward path (fraud + customer_balance
    // credit) when the subscription metadata carries a referralId. Best-
    // effort — never block the Stripe 200 on referral processing.
    try { await handleReferralInvoicePaid(ctx, invoice); }
    catch (e) { log.error('referral-webhook', e instanceof Error ? e : new Error(String(e?.message)), { event: 'referral_invoice_paid' }); }
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (customerId) {
      const tenantId = await resolveTenantIdByCustomer(ctx, customerId);
      if (tenantId) {
        // #S2-2 — dunning recovery. A paid invoice is the authoritative signal
        // that the card cleared. Restore active state directly instead of
        // waiting for a separate customer.subscription.updated, which Stripe
        // does not guarantee fires (and which can arrive out of order or be
        // dropped). Only lift tenants that are actually in a payment-trouble
        // state — never resurrect a deliberately canceled/inactive tenant.
        // Idempotent: re-firing on an already-active tenant is a no-op write.
        const cur = await dbGet(ctx, 'SELECT billing_status FROM tenants WHERE id = ?', tenantId);
        const recoverable = cur && ['grace_period', 'past_due', 'unpaid'].includes(cur.billing_status);
        if (recoverable) {
          await updateTenantBilling(ctx, tenantId, {
            billingStatus: 'active',
            subscriptionStatus: 'active',
            graceEndsAt: null,
            updatedAt: nowSec(),
          });
          // Messaging service: reactive "payment received / you're back" message
          // — only on dunning RECOVERY (not on every routine renewal, to avoid
          // monthly noise). Flag-gated, idempotent per invoice.
          fireReactiveForTenant(ctx, tenantId, {
            kind: 'sys_payment_success',
            occurrenceKey: `payment_success:${invoice?.id || tenantId}`,
          }).catch((e) => log.warn('webhooks', { action: 'reactive_payment_success', error: e?.message }));
        }
        // Multi-salon cascade (0117): mirror the parent's (possibly recovered)
        // MAX entitlement onto its secondary salons — restore them when the card
        // clears, keep them frozen if the parent is no longer an active MAX.
        try {
          const parent = await dbGet(ctx, 'SELECT plan, billing_status FROM tenants WHERE id = ?', tenantId);
          const entitled = !!parent && parent.plan === 'max' &&
            (parent.billing_status === 'active' || parent.billing_status === 'trialing');
          await setSecondarySalonsBillingStatus(ctx, tenantId, entitled ? 'active' : 'inactive');
        } catch (e) {
          log.error('webhook.multiSalonCascade.invoicePaid', e instanceof Error ? e : new Error(String(e)), { tenantId });
        }
        if (ctx.resendApiKey && ctx.resendFrom) {
          // fire-and-forget: don't block 200 response on email delivery
          sendInvoiceEmail(ctx, ctx.resendApiKey, ctx.resendFrom, tenantId, invoice)
            .catch(e => log.error('webhook.invoiceEmail', e));
        }
        // Meta CAPI: server-side Purchase on a real paid invoice (initial + every
        // renewal = a true revenue event). Skips $0 invoices (trial-start /
        // fully-discounted). Best-effort + feature-flagged; never blocks billing.
        try {
          const amountCents = Number(invoice.amount_paid || 0);
          if (amountCents > 0) {
            const email = invoice.customer_email
              || (await dbGet(ctx, 'SELECT billing_email FROM tenants WHERE id = ?', tenantId))?.billing_email;
            await sendCapiEvent(ctx, {
              eventName: 'Purchase',
              eventId: `inv_${invoice.id}`,
              email,
              value: amountCents / 100,
              currency: invoice.currency,
              eventSourceUrl: CAPI_SOURCE_URL,
            });
          }
        } catch (e) {
          log.warn('marketing.capi', { event: 'invoice_paid', error: e?.message });
        }
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
        // Multi-salon cascade (0117): the parent entered grace (card declined) —
        // freeze its secondary salons so they can't use premium features while
        // the parent is only entitled to booking during dunning.
        try {
          await setSecondarySalonsBillingStatus(ctx, tenantId, 'inactive');
        } catch (e) {
          log.error('webhook.multiSalonCascade.paymentFailed', e instanceof Error ? e : new Error(String(e)), { tenantId });
        }
        // #P1-5 (relax.md §5) — payment_failed notification email.
        // Fire-and-forget so a slow Resend never blocks the 200 we owe Stripe.
        if (ctx.resendApiKey && ctx.resendFrom) {
          sendPaymentFailedEmail(ctx, ctx.resendApiKey, ctx.resendFrom, tenantId, invoice)
            .catch(e => log.error('webhook.paymentFailedEmail', e));
        }
        // PR-B: in-app bell row. Salon owner needs to know their card was
        // declined BEFORE the grace period runs out. Dedup'd by invoice id
        // so Stripe retries (paid → declined → re-attempted) collapse into
        // one bell row per invoice cycle.
        try {
          await notifyTenantOwner({ ...ctx, tenantId }, {
            kind: 'billing.payment_failed',
            title: 'Платёж не прошёл',
            body: 'Оплата подписки отклонена. Зайди в Настройки → Биллинг, чтобы обновить карту, пока не истёк grace-период.',
            link: '/settings?section=billing',
            sourceSlug: 'billing',
            sourceId: `payment_failed:${invoice?.id || subscriptionId}`,
            inapp: true,
            telegram: false,
          });
        } catch (e) {
          log.warn('webhooks', { action: 'billing_payment_failed_bell', error: e?.message });
        }
        // Messaging service: reactive news-channel message (flag-gated, staged
        // until MESSAGING_SEND_ENABLED). Fire-and-forget — never blocks the 200.
        fireReactiveForTenant(ctx, tenantId, {
          kind: 'sys_payment_failed',
          occurrenceKey: `payment_failed:${invoice?.id || subscriptionId}`,
        }).catch((e) => log.warn('webhooks', { action: 'reactive_payment_failed', error: e?.message }));
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
      // PR-B: bell row. Dedup'd by subscriptionId so Stripe's repeated
      // trial_will_end webhooks (3-day fire + retries) collapse to one row.
      try {
        await notifyTenantOwner({ ...ctx, tenantId }, {
          kind: 'billing.trial_expiring_soon',
          title: 'Триал заканчивается',
          body: 'Через 3 дня закончится пробный период. Выбери план в Настройки → Биллинг, чтобы салон продолжил работу без перерыва.',
          link: '/settings?section=billing',
          sourceSlug: 'billing',
          sourceId: `trial_will_end:${sub.id}`,
          inapp: true,
          telegram: false,
        });
      } catch (e) {
        log.warn('webhooks', { action: 'billing_trial_will_end_bell', error: e?.message });
      }
      // Messaging service: reactive trial-ending news message (flag-gated).
      fireReactiveForTenant(ctx, tenantId, {
        kind: 'sys_trial_ending',
        occurrenceKey: `trial_will_end:${sub.id}`,
      }).catch((e) => log.warn('webhooks', { action: 'reactive_trial_ending', error: e?.message }));
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
    // Resolve the customer in the easy cases first. Stripe sends
    // `dispute.charge` as a string id by default; only expanded payloads
    // ship the full object. `dispute.payment_intent` is rarely expanded
    // either, but if it is and carries a customer we use it.
    let customerId = null;
    if (dispute?.charge && typeof dispute.charge === 'object') {
      customerId = typeof dispute.charge.customer === 'string'
        ? dispute.charge.customer
        : dispute.charge.customer?.id || null;
    } else if (dispute?.payment_intent && typeof dispute.payment_intent === 'object') {
      customerId = typeof dispute.payment_intent.customer === 'string'
        ? dispute.payment_intent.customer
        : dispute.payment_intent.customer?.id || null;
    }
    // Common case: dispute.charge is a string id and STRIPE_SECRET_KEY is
    // configured. Fetch the charge to extract the customer. Failures
    // (network error, non-200, expired key) MUST NOT break the webhook —
    // we still ack 200 and just lose the tenant tag for analytics.
    if (!customerId && typeof dispute?.charge === 'string' && ctx?.stripeSecretKey) {
      try {
        const res = await fetch(`https://api.stripe.com/v1/charges/${dispute.charge}`, {
          headers: { Authorization: `Bearer ${ctx.stripeSecretKey}` },
        });
        if (res?.ok) {
          const charge = await res.json();
          customerId = typeof charge?.customer === 'string'
            ? charge.customer
            : charge?.customer?.id || null;
        } else {
          log.warn('stripe.dispute', { message: 'charge lookup non-200', status: res?.status });
        }
      } catch (e) {
        log.warn('stripe.dispute', { message: 'charge lookup threw', error: e?.message?.slice(0, 200) });
      }
    }
    const tenantId = customerId ? await resolveTenantIdByCustomer(ctx, customerId) : null;
    log.warn('stripe.dispute', { amount: dispute?.amount, reason: dispute?.reason, tenantId });
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
