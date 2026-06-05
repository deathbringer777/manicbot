# ManicBot — Billing and Subscriptions

## Plans

| Plan   | Price      | Masters | AI Chat | Support Tickets | Calendar | White Label | Multi-salon |
|--------|------------|---------|---------|------------------|-----------|-------------|-------------|
| Start  | 45 zł/mo   | 1       | ✗       | ✗                | ✗         | ✗           | ✗           |
| Pro    | 60 zł/mo   | 5       | ✓       | ✓                | ✓         | ✗           | ✗           |
| MAX    | 90 zł/mo   | ∞       | ✓       | ✓                | ✓         | ✓           | ✓ (≤10)     |

Plan limits are set in `src/billing/config.js` (constant `PLAN_LIMITS`).

---

## Multi-salon ownership (MAX) — migration 0109

A **MAX-plan** account can own multiple salons (home + up to `MAX_OWNED_SALONS`,
default 10).

- A **secondary** salon is a `tenants` row with `parent_tenant_id` = the owner's
  **home** tenant (the billing root), plus a `tenant_roles(role='tenant_owner')`
  row keyed by the owner's deterministic synthetic chat id (`memberships.ts`).
  **No `masters` row** — the owner never appears in the new salon's staff list,
  public booking, or master limit. Ownership is resolved by
  `listMembershipsForWebUser` / `resolveActiveMembership` (role-agnostic), so the
  existing salon switcher and tenant guards work unchanged.
- **Creation:** `salon.createOwnedSalon` (gated on the home plan being `max` +
  the `MAX_OWNED_SALONS` cap). UI: the header `TenantSwitcher` "Create salon"
  entry (visible to MAX owners) → `CreateSalonModal`.
- **Billing:** secondaries are billed **under the parent's single MAX
  subscription** — they shadow `plan='max'/billingStatus='active'` so `canUse`
  works locally, are **excluded from MRR / customer counts** (`metrics.ts`,
  `billing.ts` filter out `parent_tenant_id`-set rows), and are **cascade-frozen**
  when the parent leaves MAX (`setSecondarySalonsBillingStatus`, fired from the
  `customer.subscription.updated/deleted` webhook).

---

## billing_status States

The `billing_status` field in the D1 `tenants` table:

| Status         | Description                                    | Feature Access                |
|----------------|------------------------------------------------|-------------------------------|
| `trialing`     | Trial period (14 days after registration)      | Full access per plan          |
| `active`       | Active subscription                            | Full access per plan          |
| `grace_period` | Payment failed, waiting (7 days)               | Booking only (`booking`)      |
| `past_due`     | Stripe: overdue payment                        | Per plan (until grace)        |
| `inactive`     | Trial expired or subscription not created      | Everything blocked            |
| `canceled`     | Explicit subscription cancellation             | Everything blocked            |

Feature access check: `canUse(ctx, feature)` in `src/billing/features.js`.
Possible feature values: `booking`, `ai`, `calendar`, `support_tickets`, `masters_add`, `white_label`, `whatsapp`, `instagram`, `multi_salon`.

---

## Admin grant codes (SVC-)

System-admin–issued one-time codes that comp a tenant a free subscription
period (launch use case: one free year of `max`). Generated in God Mode at
`/system/grant-codes` (router `subscriptionGrantCodes`). The tester types the
code into the registration "friend's promo code" field; it is routed by the
reserved `SVC-` prefix, distinct from peer referral codes (which are always
`[A-Z]{4}-…`).

- **Storage:** `subscription_grant_codes` (migration 0103). Only the SHA-256
  **hash** of the code is stored — the plaintext is shown to the admin once at
  generation. A random / never-generated string is rejected (hash miss).
- **Redemption** (`redeemGrantCodeAtRegistration`, called fail-open from
  `webUsers.register`): a single atomic
  `UPDATE … WHERE status='active' RETURNING id` claims the code (one-time,
  race-safe), then the tenant is set to `plan` + `billing_status='active'` +
  `current_period_end = now + duration_days` — the same field set as
  `billing.manualActivate`.
- **Guard:** generation/list/revoke require `systemAdminProcedure`; redemption
  applies the grant only to the just-created tenant.

---

## Lifecycle

```
Registration → trialing (14 days)
                │
                ├─ subscription paid (Stripe Checkout)
                │         ↓
                │       active ◄─────────────────────────────┐
                │         │                                   │
                │         │ payment_failed (Stripe webhook)   │ invoice.payment_succeeded
                │         ↓                                   │
                │   grace_period (7 days: booking only)       │
                │         │                                   │
                │         │ grace expired (cron */15 min)     │
                │         ↓                                   │
                └──────► inactive ◄── subscription canceled
```

**Cron task** (`handlers/cron.js`) every 15 minutes:
- Calls `checkBillingExpiry()` (`billing/lifecycle.js`)
- Transitions `trialing` → `inactive` when `trial_ends_at` has expired
- Transitions `grace_period` → `inactive` when `grace_ends_at` has expired

**Real-time bridge** (between cron ticks): both `auth.getMyRole` and `salon.getBillingStatus` evaluate `evaluateTrialState()` (`admin-app/src/lib/billing/trialState.ts`) on every call. If a trial has expired in the DB but cron hasn't flipped it yet, they return the post-flip status synchronously and fire-and-forget the persisting UPDATE. The admin-app `BillingGate` component reads `isTrialExpired` from `getMyRole` and blocks the whole tenant dashboard (with `/billing`, `/settings`, `/plugins`, `/plugin/*` whitelisted) so staff-side features become unreachable the moment the trial ends, without waiting for cron.

---

## Stripe Environment Variables

| Secret                        | Description                                                                  |
|-------------------------------|------------------------------------------------------------------------------|
| `STRIPE_SECRET_KEY`           | `sk_live_...` or `sk_test_...`                                               |
| `STRIPE_WEBHOOK_SECRET`       | `whsec_...` (from Stripe Dashboard)                                          |
| `STRIPE_PRICE_START_MONTHLY`  | `price_...` for Start plan (monthly)                                         |
| `STRIPE_PRICE_PRO_MONTHLY`    | `price_...` for Pro plan (monthly)                                           |
| `STRIPE_PRICE_MAX_MONTHLY`    | `price_...` for MAX plan (monthly)                                           |
| `STRIPE_PRICE_START_ANNUAL`   | `price_...` for Start plan (annual) — optional                               |
| `STRIPE_PRICE_PRO_ANNUAL`     | `price_...` for Pro plan (annual) — optional                                 |
| `STRIPE_PRICE_MAX_ANNUAL`     | `price_...` for MAX plan (annual) — optional                                 |
| `APP_BASE_URL`                | `[vars]` — already in `wrangler.toml` as `https://manicbot.com`; not a secret |

Quick setup: `cd manicbot && ./scripts/setup-stripe-secrets.sh`

---

## Stripe Events → Actions

| Stripe Event                               | Action in ManicBot                                                |
|--------------------------------------------|-------------------------------------------------------------------|
| `checkout.session.completed`               | `billing_status=active`, customer_id → D1 `stripe_customers`     |
| `customer.subscription.updated`            | Sync plan, status, `current_period_end`                           |
| `customer.subscription.deleted`            | `billing_status=inactive`                                         |
| `invoice.payment_failed`                   | `billing_status=grace_period`, `grace_ends_at=now+7days`          |
| `invoice.paid`                             | Dunning recovery: `grace_period`/`past_due`/`unpaid` → `active` (clears `grace_ends_at`); plugin addon billing; referral commission recording |
| `invoice.payment_succeeded`                | Same handler as `invoice.paid` (dunning recovery + plugin addon billing + referral commission recording) |
| `customer.subscription.trial_will_end`     | Fire notification to tenant; deduplicated per subscription        |
| `invoice.upcoming`                         | Fire payment-due notification to tenant                           |
| `charge.dispute.created`                   | Log dispute event to `billing_events`                             |

> **Note on grace recovery (`#S2-2`):** the `invoice.payment_succeeded`/`invoice.paid` handler is the
> authoritative dunning-recovery path — a paid invoice is the signal that the card cleared, so it
> restores `billing_status` → `active` directly (only for tenants currently in `grace_period`/`past_due`/`unpaid`;
> never resurrects a deliberately `canceled`/`inactive` tenant) instead of waiting for a separate
> `customer.subscription.updated`, which Stripe does not guarantee fires. The flip is idempotent.

Handler: `src/billing/webhooks.js` → `handleStripeWebhook()`.
Billing record in D1: `src/billing/storage.js` → `updateTenantBilling()`.

---

## Utility Functions

| Function                      | File                         | Description                               |
|------------------------------|------------------------------|-------------------------------------------|
| `canUse(ctx, feature)`       | `billing/features.js`        | Whether feature is allowed for tenant     |
| `getMastersLimit(ctx)`       | `billing/features.js`        | Max masters per plan                      |
| `isTrialing(ctx)`            | `billing/features.js`        | Is tenant on trial?                       |
| `isGracePeriod(ctx)`         | `billing/features.js`        | Is tenant in grace_period?                |
| `isInactive(ctx)`            | `billing/features.js`        | Is tenant blocked?                        |
| `trialRemainingDays(ctx)`    | `billing/features.js`        | Days until trial ends                     |
| `graceRemainingDays(ctx)`    | `billing/features.js`        | Days until grace_period ends              |
| `checkBillingExpiry(ctx)`    | `billing/lifecycle.js`       | Check and transition statuses (cron)      |
| `updateTenantBilling(ctx, …)`| `billing/storage.js`         | Update billing in D1                      |
