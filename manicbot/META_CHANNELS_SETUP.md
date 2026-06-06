# Instagram and WhatsApp (Meta) — Salon Setup Guide

**Instagram Direct** and **WhatsApp** channels are available on **Pro** and **Max** plans. Setup is done in the **Telegram Mini App** (Channels tab) and in **Meta for Developers**.

## What you need

- A **Meta Business** account and access to the **Facebook Page** linked to the Instagram profile (for Instagram).
- For WhatsApp — a number connected to the **WhatsApp Business Platform** (Cloud API) via Meta.
- Access to [developers.facebook.com](https://developers.facebook.com/apps) with app permissions.

## Step 1. Open the salon Mini App

1. In **Telegram**, open your salon bot.
2. Press **/start** (if you're the owner/admin, the management panel will appear).
3. Or press the **"Salon"** menu button (or the **"Instagram / WhatsApp"** button in the admin panel).
4. In the Mini App, open the **Channels** tab.

Here you'll see:

- **Webhook URL** for WhatsApp and for Instagram (different paths).
- **Verify Token** — **must match** what's set on the ManicBot platform side (Worker secrets and Pages variables). If the interface shows a warning instead of a token — contact platform support to set `META_VERIFY_TOKEN_WA` / `META_VERIFY_TOKEN_IG` and `WORKER_PUBLIC_URL` in the Mini App.

## Step 2. Meta for Developers — app and webhooks

1. Create or select a **Business** type app.
2. Add products:
   - **WhatsApp** (Cloud API) — for WhatsApp;
   - **Instagram** — for Instagram messages (Messaging API), per Meta documentation for your scenario.
3. In the **Webhooks** section:
   - provide the **Callback URL** from the Mini App (separate for WA and IG if Meta requires two connections);
   - paste the **Verify Token** **exactly** as shown in the Mini App;
   - subscribe to the needed fields (messages, statuses, etc. — per Meta requirements).

After successful verification, Meta will send events to the ManicBot Worker.

**Worker routing:** requests to `POST /webhook/ig` and `POST /webhook/wa` are handled **before** the Telegram `/webhook/{botId}` logic; `ig` and `wa` segments are not treated as numeric bot ids. Background message processing is bound to Cloudflare `waitUntil` so that Meta's "OK" response doesn't cut off the pipeline.

## HTML admin panel (`/admin`)

Read-only channel status is now also visible in the Worker HTML panel:

- **Telegram** — bot id + webhook URL
- **WhatsApp** — active/inactive + `phone_number_id` + `/webhook/wa`
- **Instagram** — active/inactive + `page_id` / `ig_account_id` + `/webhook/ig`

Token editing and saving remains only in **Mini App → Channels**.

## Step 3. Save credentials in Mini App

### WhatsApp

In Meta, get the **Phone Number ID** (and if necessary the **WABA ID**). Create a **long-lived access token** with the permissions needed for sending messages.

In Mini App → **Channels** → WhatsApp, enter the ID and token, click **Save & Connect**.

### Instagram

You need the **Page ID** of the Facebook Page (linked to Instagram) and a **Page Access Token** with messaging permissions. The bot sends outgoing messages via **graph.facebook.com** (Messenger Platform / Instagram), not `graph.instagram.com`.

In Mini App → **Channels** → Instagram, enter the values and save.

#### `entry.id` in webhook and the field in Mini App

In the Instagram webhook payload, **`entry[0].id`** must match (after string coercion) one of the identifiers saved in the config:

- **`page_id`** — Facebook Page ID (what Meta usually shows in page settings).
- If it doesn't match what actually comes in **Recent deliveries**, you can add optional fields **`instagram_business_id`** or **`ig_account_id`** to the JSON config (via support/migration) — the Worker will match the webhook against any of them.

Verification: Meta → Webhooks → **Recent deliveries** for Instagram → expand the body and compare `entry[0].id` with what's saved in Channels.

## Important Meta Limitations

- **Messaging window** (24 hours and WhatsApp template rules) applies per Meta's rules — the bot cannot message clients without restrictions outside these windows.
> **Important (2026-04-05):** If `BOT_ENCRYPTION_KEY` is set, plaintext fallback for Meta tokens is disabled. If decryption fails, the token will be `null`. Make sure all tokens are encrypted before setting the key.

- Keep tokens and **App Secret** confidential. If a secret or token appears in chat, logs, or a screenshot — treat them as compromised: in Meta generate a new **App Secret** and run `wrangler secret put META_APP_SECRET` on the Worker; for **Page Access Token** regenerate the token in Business Suite and update in Mini App → Channels. After changing secrets, redeploy the Worker (`wrangler deploy`).

## Environment Variables (for platform owner)

For the Mini App to show the same **Verify Token** that the Worker checks:

| Where | Variable |
|-------|----------|
| Cloudflare Worker (secrets) | `META_VERIFY_TOKEN_WA`, `META_VERIFY_TOKEN_IG`, `META_APP_SECRET` (for `X-Hub-Signature-256` signature on POST) |
| Cloudflare Worker (secrets, optional) | `META_INSTAGRAM_APP_SECRET` — App Secret of the separate **Instagram Login** product (post-Mar-2026, `instagram_direct` channels). The Worker verifies the IG webhook signature against `META_APP_SECRET` first, then falls back to this. Only needed for IGAA-token channels. |
| Cloudflare Pages (Mini App) | Same `META_VERIFY_TOKEN_WA`, `META_VERIFY_TOKEN_IG`, plus `WORKER_PUBLIC_URL` (public Worker URL without trailing `/`) |

Verify token values on Worker and Pages must **match**.

### Service account (e.g. @manicbot_com)

In Instagram webhooks only the **numeric IGSID** of the sender comes through, not the @username.

- Messages **sent from the page** (echo) are already **not processed** by the Worker (`is_echo` in payload).
- To avoid sending personal/service messages from a fixed account to **LLM**, set the Worker secret:
  - `wrangler secret put INSTAGRAM_IGNORE_SENDER_IDS`
  - value: one or more IGSIDs comma or space separated, e.g. `1784360123456789`.

**How to find the IGSID for @manicbot_com:** send a test DM to the bot and check the `sender.id` field in the webhook body in Meta logs (**Webhook fields** → **Test** / **Recent deliveries**) or request the profile via Instagram Graph API for the linked Business account (requires appropriate token permissions).

### Optional: AI trigger words for Instagram

By default, free text from Direct goes to the same AI as in Telegram. To **not** invoke LLM on every message, set the Worker secret:

- `wrangler secret put INSTAGRAM_AI_TRIGGER`
- value: substrings comma-separated; leading/trailing spaces are trimmed per element, empty segments discarded. Example: `booking, question, manic`

A message will go to AI only if the text (case-insensitive) **contains** at least one substring. Otherwise the user gets a short hint (key `ig_ai_trigger_hint` in translations). Booking scenarios and the `REG_CONFIRM` step are unaffected.

If the secret is **empty** or not set — no restriction (same as before).

### Token lifecycle (Instagram Login / `instagram_direct`)

IGAA tokens (the **Instagram Login** product, `config.api = "instagram_direct"`) are **long-lived for 60 days** and refreshable. On connect — via OAuth or `POST /admin/ig-set-direct-token` — the Worker records `channel_configs.token_expires_at`, and a daily cron (`phaseChannelHealth`) auto-refreshes the token ~10 days before expiry against `graph.instagram.com`. No manual re-auth is needed under normal operation.

- Legacy Page Access Tokens (`api = "facebook"`, EAA…) are **non-expiring**, so `token_expires_at` stays `NULL` and no refresh runs.
- If a refresh fails (token revoked, app permissions changed), the channel surfaces `integration.needs_reauth` and the operator re-connects via the Mini App or `POST /admin/ig-token`.

## Smoke Checklist (platform + salon)

**Automated in the repository:** the `buildMetaChannelHints` test in admin-app (`npm test` in `manicbot/admin-app`) verifies webhook URL formation and token truncation.

**Manually after setting secrets:**

1. **Pages / Worker:** in Cloudflare, the same `META_VERIFY_TOKEN_*` is set both on Worker (secrets) and in the Pages project `admin-app` (see [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md)).
2. **Mini App:** log in as salon owner → **Channels** tab → **Verify Token** lines are visible (not yellow warning) and the correct domain shows in **Webhook URL**.
3. **Meta:** in the developer app click **Verify** for webhook — response should be successful (Worker handles the challenge).
4. **Instagram:** in **Recent deliveries** for POST to `…/webhook/ig` status is **200** (not 403). If 403 — check `META_APP_SECRET` and Worker response body.
5. **Telegram:** after `/start`, the owner has a **"Salon"** menu (or a channels button in the admin panel on Pro+) and the link opens the Mini App with `?tab=channels` when channels are available on the plan.

## Troubleshooting

- **Meta verification passes but bot is silent:** verify that `META_APP_SECRET`, the required `META_VERIFY_TOKEN_*`, and the latest code are deployed on the Worker. For Telegram/D1 fallback, check Worker logs for `[worker] context resolution failed`.
- **Mini App doesn't show verify token:** this is usually a Pages env issue. Set `META_VERIFY_TOKEN_WA` / `META_VERIFY_TOKEN_IG` and `WORKER_PUBLIC_URL` in the `admin-app` project.
- **`/admin` doesn't show IG/WA channel:** check that the tenant has rows in `channel_configs` and you're opening `/admin` within a tenant-aware Worker context, not just the platform billing page.
- **Instagram webhook returns 403:** compare `META_APP_SECRET` with the Meta app secret and check the Worker response body in Recent deliveries.

## Test Tenant for E2E (Instagram as bot chat)

**Who pays:** subscription and trial are tied to the **tenant (salon)**. Users who write in Instagram Direct **pay nothing** — they get the client role, billing is checked per salon ([`src/billing/features.js`](src/billing/features.js)).

### 1) Create tenant + bot + owner in D1

From the `manicbot/` directory (requires `wrangler` and D1 access):

```bash
# Preview SQL without executing:
npm run ig-e2e:tenant -- --owner=YOUR_TELEGRAM_USER_ID --bot-id=BOT_ID_FROM_TOKEN --dry-run

# Write to remote D1 (default):
npm run ig-e2e:tenant -- --owner=YOUR_TELEGRAM_USER_ID --bot-id=BOT_ID_FROM_TOKEN

# Local D1 for wrangler dev:
npm run ig-e2e:tenant -- --owner=YOUR_TELEGRAM_USER_ID --bot-id=BOT_ID_FROM_TOKEN --local
```

Default runs `wrangler d1 execute … --remote`; for local database add **`--local`**. Script: [`scripts/create-ig-e2e-tenant.mjs`](scripts/create-ig-e2e-tenant.mjs).

- Creates a tenant with **`plan = pro`**, **`billing_status = trialing`**, trial ~30 days.
- **`bots`** row: if bot already exists — only **`tenant_id`** is updated (webhook secret is preserved); if bot didn't exist — a new row is inserted (then register the token the usual way).
- **`tenant_roles`**: your Telegram `chat_id` gets **`tenant_owner`** for Mini App → **Channels** access.

Alternative without script: God Mode in Mini App → create tenant + attach bot ([`admin-app/src/server/api/routers/provisioning.ts`](admin-app/src/server/api/routers/provisioning.ts)).

### 2) Connect Instagram in Mini App

Log into Mini App with **the same Telegram account** specified in `--owner` → **Channels** → Instagram: **Page ID** and **Page Access Token**. Compare **`entry[0].id`** from Meta → Webhooks → **Recent deliveries** with the field in the config (see section above on `page_id` / `instagram_business_id` / `ig_account_id`).

### 3) Worker secrets before testing

- **`META_APP_SECRET`** — must match the Meta app (otherwise POST **403**).
- **`INSTAGRAM_AI_TRIGGER`** — **do not set** (empty), so it responds to any text including "hello".
- **`INSTAGRAM_IGNORE_SENDER_IDS`** — **do not** include the IGSID of the test client you're writing from.

### 4) Manual scenario in Instagram

1. From a personal client account, write a DM to the page linked to this tenant.
2. Verify in **Recent deliveries**: **200** on `POST …/webhook/ig`.
3. Expect a text response; "buttons" in IG are **quick replies** (Meta limitations), not the full Telegram UI copy.

On failure, check Worker logs for: `[ig] unresolved page_id`, `[ig] missing token`, `[ig] POST … failed`.
