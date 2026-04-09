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
npx wrangler secret put APP_BASE_URL           # Worker URL, e.g. https://manicbot.YOUR_SUBDOMAIN.workers.dev
```

Optional (if using plan-based subscriptions):

```bash
npx wrangler secret put STRIPE_PRICE_START_MONTHLY   # price_xxx from Stripe
npx wrangler secret put STRIPE_PRICE_PRO_MONTHLY
npx wrangler secret put STRIPE_PRICE_MAX_MONTHLY
```

## 2. Webhook in Stripe Dashboard

1. Open [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks).
2. **Add endpoint**.
3. **Endpoint URL:** `https://manicbot.YOUR_SUBDOMAIN.workers.dev/stripe/webhook`
4. **Events to send:** select:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
5. Save. Copy the **Signing secret** (whsec_...) and store it in the worker secret:
   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

## 3. Products and prices (for subscriptions)

In [Stripe Dashboard → Products](https://dashboard.stripe.com/products) create products and prices (recurring, monthly). Copy the **Price ID** (price_...) and set secrets:

- `STRIPE_PRICE_START_MONTHLY`
- `STRIPE_PRICE_PRO_MONTHLY`
- `STRIPE_PRICE_MAX_MONTHLY`

## 4. APP_BASE_URL

Must match the worker URL so that payment links and the success page work correctly. Example:

```
https://manicbot.vdovin-kyrylo.workers.dev
```

Set via secret or in `wrangler.toml` under `[vars]`.

## 5. Verification

- Bot admin: **Management** → **💳 Subscription & Payment** — billing menu.
- Platform: open `/admin` in browser (Basic Auth), then the **💳 Billing (all tenants)** link.

No redeploy needed after changing secrets — they are picked up on the next request.
