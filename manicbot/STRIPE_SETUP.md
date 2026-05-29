# Stripe Setup for ManicBot

## 0. Where to get keys in Stripe Dashboard

- **Developers → API keys** (as in your screenshot):
  - **Secret key** (Standard keys) — click **Reveal live key** and copy. This is `STRIPE_SECRET_KEY` (don't share it, only use in `wrangler secret put`).
  - For testing, enable **Test mode** (toggle on the right) and use the test Secret key (`sk_test_...`).
- **Publishable key** (`pk_live_...` / `pk_test_...`) — if needed later for client-side payments, store in variables (not a secret).

## 1. Worker secrets (required)

Run the script — it will prompt for each required value. Fill in your data when asked:

```bash
cd manicbot
chmod +x scripts/setup-stripe-secrets.sh
./scripts/setup-stripe-secrets.sh
```

Or manually:

```bash
cd manicbot
npx wrangler secret put STRIPE_SECRET_KEY      # Secret key from Stripe (sk_live_... or rk_live_...)
npx wrangler secret put STRIPE_WEBHOOK_SECRET  # Signing secret from Stripe after webhook creation
# NOTE: APP_BASE_URL is a [vars] entry in wrangler.toml (already set to https://manicbot.com).
# Do NOT set it as a secret — update wrangler.toml if you need to change it.
```

Monthly pricing (required for subscriptions):

```bash
npx wrangler secret put STRIPE_PRICE_START_MONTHLY   # price_xxx from Stripe
npx wrangler secret put STRIPE_PRICE_PRO_MONTHLY
npx wrangler secret put STRIPE_PRICE_MAX_MONTHLY
```

Annual pricing (optional — only if offering annual plans):

```bash
npx wrangler secret put STRIPE_PRICE_START_ANNUAL
npx wrangler secret put STRIPE_PRICE_PRO_ANNUAL
npx wrangler secret put STRIPE_PRICE_MAX_ANNUAL
```

## 2. Webhook in Stripe Dashboard

1. Open [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks).
2. **Add endpoint**.
3. **Endpoint URL:** `https://manicbot.com/stripe/webhook`
4. **Events to send:** select all nine events the handler implements:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
   - `invoice.paid`
   - `invoice.payment_succeeded`
   - `customer.subscription.trial_will_end`
   - `invoice.upcoming`
   - `charge.dispute.created`
5. Save. Copy the **Signing secret** (whsec_...) and store it in the worker secret:
   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

## 3. Products and prices (for subscriptions)

In [Stripe Dashboard → Products](https://dashboard.stripe.com/products) create products and prices (recurring, monthly and/or annual). Copy the **Price ID** (price_...) and set secrets as shown in step 1.

Monthly plans required:

- `STRIPE_PRICE_START_MONTHLY`
- `STRIPE_PRICE_PRO_MONTHLY`
- `STRIPE_PRICE_MAX_MONTHLY`

Annual plans (optional):

- `STRIPE_PRICE_START_ANNUAL`
- `STRIPE_PRICE_PRO_ANNUAL`
- `STRIPE_PRICE_MAX_ANNUAL`

## 4. APP_BASE_URL

`APP_BASE_URL` is a `[vars]` entry in `wrangler.toml` already set to `https://manicbot.com`.
It is used for payment redirect links and the Stripe success page.
Update `wrangler.toml` directly if the value needs to change — do not set it via `wrangler secret put`.

## 5. Verification

- Bot admin: **Management** → **💳 Subscription & Payment** — billing menu.
- Platform: open `/admin` in browser (Basic Auth), then the **💳 Billing (all tenants)** link.

No redeploy needed after changing secrets — they are picked up on the next request.
