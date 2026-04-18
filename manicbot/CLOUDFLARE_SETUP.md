# Cloudflare Setup Verification for ManicBot

If AI doesn't respond in the bot (always "I don't understand") or consultant notifications don't arrive — check through these steps.

## 0. D1 Database (required on first deploy)

ManicBot uses **Cloudflare D1** (SQL) for storing tenants, masters, appointments, and roles.

### Create the database:
```bash
cd manicbot
npx wrangler d1 create manicbot-db
```

Copy the `database_id` from the output to `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "manicbot-db"
database_id = "YOUR-ID"
```

### Initialize the schema:
```bash
npx wrangler d1 execute manicbot-db --remote --file src/db/schema.sql
```

### Verify:
```bash
npx wrangler d1 execute manicbot-db --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
```
Should return around **20+** tables (including `channel_configs`, `conversations`, `message_windows` for the unified inbox). After changes in `migrations/` and `schema.sql`, sync Drizzle (`admin-app/src/server/db/schema.ts`) and run **`npm run check-schema`** in the `manicbot/` directory.

### Existing data (if you had a KV-only setup):
If you already have a bot running with KV storage, run the data migration — see **MIGRATION.md**.

---

## 1. Workers AI via API token (recommended)

If the binding doesn't work, connect via REST API by token:

1. In the dashboard: **Build → AI → Workers AI** — copy the **Account ID** and click **Create a Workers AI API Token** (Read + Edit permissions).
2. Set secrets for the worker in the project:
   ```bash
   cd manicbot
   wrangler secret put WORKERS_AI_API_TOKEN
   # paste the token when prompted
   wrangler secret put CLOUDFLARE_ACCOUNT_ID
   # paste the Account ID (e.g. 07dbabce20f0e9f375a020b5314d5427)
   ```
3. Deploy: `npm run deploy`.

Code tries REST with token first; if token and Account ID are set — binding is not used for AI.

## 2. Workers AI is enabled

- Go to **Cloudflare Dashboard** → **Build** → **AI** → **Workers AI**.
- The page should open without errors. If the product is not enabled — enable it for the account.
- On the free plan there's a daily Neurons limit; requests may fail if exceeded.

## 3. AI binding on the worker

- **Workers & Pages** → select the **manicbot** worker → **Settings** → **Variables**.
- In the **Bindings** section there should be an **AI** binding (type Workers AI). It's added from `wrangler.toml` on `wrangler deploy`.
- If the binding is missing — run `npm run deploy` again from the `manicbot` folder.

## 4. Model

The code uses:

- primary: `@cf/openai/gpt-oss-120b`;
- fallback: `@cf/meta/llama-3.1-8b-instruct`.

If the primary model is unavailable in your account/region, responses will go through the fallback.

## 5. "Connect a consultant" notifications

For someone to receive a notification when the "Connect a consultant" button is pressed:

- The bot must have a registered **admin** (command `/admin YOUR_ADMIN_KEY`) and/or **masters** added in the admin panel.
- Optionally: set the **ADMIN_CHAT_ID** variable in worker settings (numeric Telegram chat_id), and notifications will also be sent there. This user is also considered the **platform creator**: they have full access to the platform panel (/panel — Salons, Bot Registration, Support Agents), all buttons work without the /sysadmin command.

## 6. Logs on AI errors

- **Workers & Pages** → **manicbot** → **Logs** (Real-time logs or Analytics).
- Search logs for lines `Workers AI error:` or `Workers AI run ... error:` — these indicate if the model call is failing and with what error.

## 7. Stripe (subscriptions and payments)

Full setup: **STRIPE_SETUP.md**. Quick summary: set secrets (run the script once):

```bash
cd manicbot && chmod +x scripts/setup-stripe-secrets.sh && ./scripts/setup-stripe-secrets.sh
```

When prompted, provide: Stripe Secret key, Webhook signing secret, Worker URL (APP_BASE_URL). In Stripe Dashboard, add a webhook to `https://YOUR_WORKER.workers.dev/stripe/webhook`.

## 8. Quick Checklist

| Check | Where to look |
|----------|----------------|
| D1 created and schema loaded | `wrangler d1 execute manicbot-db --remote --file src/db/schema.sql` |
| Workers AI enabled | Build → AI → Workers AI |
| Worker has AI binding | Workers → manicbot → Settings → Variables → Bindings |
| Worker has DB binding | Workers → manicbot → Settings → Variables → Bindings → D1 |
| Deploy after changes | `npm run deploy` in the manicbot folder |
| Admin/masters for notifications | Bot: /admin, master panel |
| AI errors | Workers → manicbot → Logs |
| Stripe (billing) | STRIPE_SETUP.md, scripts/setup-stripe-secrets.sh |

## 9. Multi-tenancy: deploy with a single working tenant

Entry point is **src/worker.js** (`wrangler.toml` specifies `main = "src/worker.js"`). The root `worker.js` is not used during deploy.

After the first deploy, you need to run the migration once and reconfigure the webhook:

1. **Migration** (creates the `default` tenant and migrates data from the bot prefix to `t:default:`):
   ```
   GET https://YOUR_WORKER.workers.dev/admin/migrate?key=YOUR_ADMIN_KEY
   ```
   The response should have `"ok": true` and `"copied": N` (or `"skipped": true` if migration was already done).

2. **Telegram webhook** after migration must point to the path with `botId`:
   ```
   https://YOUR_WORKER.workers.dev/webhook/BOT_ID
   ```
   (BOT_ID — the first part of the bot token, before the colon.) Easiest way — open:
   ```
   https://YOUR_WORKER.workers.dev/setup?key=YOUR_ADMIN_KEY
   ```
   The response will contain the required webhook URL — copy it and update in the bot settings (BotFather / setWebhook) if necessary.

3. **Cron** is already configured in wrangler (`*/15 * * * *`): reminders and cleanup run per tenant.

Detailed code analysis and conflicts — in **CODE_ANALYSIS.md**.

---

### Migration 0010: Google Calendar Sync Backoff

```sql
ALTER TABLE appointments ADD COLUMN sync_retries INTEGER DEFAULT 0;
ALTER TABLE appointments ADD COLUMN sync_retry_after INTEGER DEFAULT NULL;
ALTER TABLE appointments ADD COLUMN sync_last_error TEXT DEFAULT NULL;
```

---

## Mini App (Pages): Instagram / WhatsApp — interface hints

For the **Channels** tab to show the same **Verify Token** and webhook base URL that the Worker uses:

| Variable (Cloudflare Pages → Settings → Variables) | Purpose |
|------------------------------------------------------|----------|
| `WORKER_PUBLIC_URL` | Public Worker URL, e.g. `https://manicbot.com` (no trailing `/`) |
| `META_VERIFY_TOKEN_WA` | Same value as in `wrangler secret put META_VERIFY_TOKEN_WA` |
| `META_VERIFY_TOKEN_IG` | Same value as in `wrangler secret put META_VERIFY_TOKEN_IG` |

Worker-only (not Pages):

| Secret | Purpose |
|--------|----------|
| `META_APP_SECRET` | App Secret from Meta — `X-Hub-Signature-256` signature on POST `/webhook/wa` and `/webhook/ig`. Without matching the Meta app, response is **403**, messages are not processed (GET challenge may still pass). |
| `META_VERIFY_TOKEN_WA` / `META_VERIFY_TOKEN_IG` | Webhook verification strings (duplicated in Pages for Mini App). |
| `INSTAGRAM_IGNORE_SENDER_IDS` | Optional: IGSIDs comma/space separated — don't process these senders (service accounts). See **META_CHANNELS_SETUP.md**. |
| `INSTAGRAM_AI_TRIGGER` | Optional: comma-separated substrings — if set, free text in Instagram without a match is not sent to LLM (see **META_CHANNELS_SETUP.md**). Empty = same as Telegram. |

Client instructions: **META_CHANNELS_SETUP.md**.

**CLI (alternative to Pages UI fields):** from the directory with `wrangler` installed and authorized to the Cloudflare account:

```bash
cd manicbot/admin-app
npx wrangler pages secret put WORKER_PUBLIC_URL --project-name=admin-app
npx wrangler pages secret put META_VERIFY_TOKEN_WA --project-name=admin-app
npx wrangler pages secret put META_VERIFY_TOKEN_IG --project-name=admin-app
```

Provide the same values set on the Worker (`wrangler secret put META_VERIFY_TOKEN_WA`, etc.). After changing secrets, do a new Pages deploy (push to `main` or manual `pages deploy`).
