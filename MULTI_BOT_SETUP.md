# Multi-bot: Salons + Masters

Current scheme: **D1** (`tenants`, `bots`) + webhook **`POST /webhook/{botId}`** (numeric bot id from the token). Demo self-provisioning with `BOT_TOKEN_SALON*` secrets — see `src/http/demoBots.js`. Full picture — **[CLAUDE.md](CLAUDE.md)**.

**Important:** If tokens have been exposed in chat — in @BotFather press "Revoke current token" and put only the **new** token into secrets.

## Cloudflare Secrets (Wrangler)

Tokens must **never** be stored in code. Secrets only.

```bash
# Required
wrangler secret put ADMIN_KEY
wrangler secret put WEBHOOK_SECRET

# Salons
wrangler secret put BOT_TOKEN_SALON1
wrangler secret put BOT_TOKEN_SALON2

# Masters
wrangler secret put BOT_TOKEN_MASTER1
wrangler secret put BOT_TOKEN_MASTER2

# For admin panel and cron — any one token (e.g. salon1)
wrangler secret put BOT_TOKEN
```

## Webhook for each bot

After deploy, call `setWebhook` for **each** bot to a URL with the **numeric** `botId` (the digits before `:` in the token), for example:

`https://manicbot.com/webhook/123456789`

The service endpoint **`GET /setup?key=ADMIN_KEY`** (see `adminPanelHttp.js`) sets the webhook for the current context (`BOT_TOKEN` or bot from D1). Bulk provisioning: **`POST /admin/provision?key=...`**.

## Data

Each salon has its own **`tenant_id`** in D1; KV prefix for runtime: **`t:{tenantId}:*`**. Appointments and users are isolated by `tenant_id` in SQL.

## Cron (reminders)

Reminders currently run for only one tenant — the one whose token is stored in **BOT_TOKEN**. Usually the first bot (salon1) token is set there. To have reminders work for salon2 as well, the cron can be extended later to iterate over the bot list.
