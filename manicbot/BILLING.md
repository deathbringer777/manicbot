# ManicBot — Billing and Subscriptions

## Plans

| Plan   | Price      | Masters | AI Chat | Support Tickets | Calendar | White Label |
|--------|------------|---------|---------|------------------|-----------|-------------|
| Start  | 45 zł/mo   | 1       | ✗       | ✗                | ✗         | ✗           |
| Pro    | 60 zł/mo   | 5       | ✓       | ✓                | ✓         | ✗           |
| MAX    | 90 zł/mo   | ∞       | ✓       | ✓                | ✓         | ✓           |

Plan limits are set in `src/billing/config.js` (constant `PLAN_LIMITS`).

---

## billing_status States

The `billing_status` field in the D1 `tenants` table:

| Status         | Description                                    | Feature Access                |
|----------------|------------------------------------------------|-------------------------------|
| `trialing`     | Trial period (7 days after registration)       | Full access per plan          |
| `active`       | Active subscription                            | Full access per plan          |
| `grace_period` | Payment failed, waiting (7 days)               | Booking only (`booking`)      |
| `past_due`     | Stripe: overdue payment                        | Per plan (until grace)        |
| `inactive`     | Trial expired or subscription not created      | Everything blocked            |
| `canceled`     | Explicit subscription cancellation             | Everything blocked            |

Feature access check: `canUse(ctx, feature)` in `src/billing/features.js`.
Possible feature values: `booking`, `ai`, `calendar`, `tickets`, `white_label`.

---

## Lifecycle

```
Registration → trialing (7 days)
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

---

## Stripe Environment Variables

| Secret                        | Description                                     |
|-------------------------------|-------------------------------------------------|
| `STRIPE_SECRET_KEY`           | `sk_live_...` or `sk_test_...`                  |
| `STRIPE_WEBHOOK_SECRET`       | `whsec_...` (from Stripe Dashboard)             |
| `STRIPE_PRICE_START_MONTHLY`  | `price_...` for Start plan                      |
| `STRIPE_PRICE_PRO_MONTHLY`    | `price_...` for Pro plan                        |
| `STRIPE_PRICE_MAX_MONTHLY`    | `price_...` for MAX plan                        |
| `APP_BASE_URL`                | `https://manicbot.com` (redirect after payment) |

Quick setup: `cd manicbot && ./scripts/setup-stripe-secrets.sh`

---

## Stripe Events → Actions

| Stripe Event                         | Action in ManicBot                                            |
|--------------------------------------|---------------------------------------------------------------|
| `checkout.session.completed`         | `billing_status=active`, customer_id → D1 `stripe_customers` |
| `customer.subscription.updated`      | Sync plan, status, `current_period_end`                       |
| `customer.subscription.deleted`      | `billing_status=inactive`                                     |
| `invoice.payment_failed`             | `billing_status=grace_period`, `grace_ends_at=now+7days`      |
| `invoice.payment_succeeded`          | `billing_status=active` (if was grace_period)                 |

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
