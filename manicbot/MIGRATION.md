# What is the migration

## Prerequisite: D1

Before running any migration, make sure D1 is initialized:

1. `npx wrangler d1 create manicbot-db` (or check that it already exists in `wrangler.toml`)
2. `npx wrangler d1 execute manicbot-db --remote --file src/db/schema.sql`

**If D1 already contains data with timestamps in milliseconds** (old records before the fix):
```bash
npx wrangler d1 execute manicbot-db --remote --command "
UPDATE tenants SET created_at = created_at/1000 WHERE created_at > 9999999999;
UPDATE tenants SET updated_at = updated_at/1000 WHERE updated_at > 9999999999;
UPDATE tenants SET trial_ends_at = trial_ends_at/1000 WHERE trial_ends_at IS NOT NULL AND trial_ends_at > 9999999999;
UPDATE appointments SET created_at = created_at/1000 WHERE created_at > 9999999999;
UPDATE masters SET added_at = added_at/1000 WHERE added_at IS NOT NULL AND added_at > 9999999999;
"
```

---

**Migration** is a one-time step that transitions the bot from "one bot = one KV namespace chunk" mode to **multi-tenant** mode: a single worker can serve many bots/salons with isolated data per tenant.

## What it does

1. **Creates the `default` tenant**
   A `tenant:default` entry is written to KV (salon name, address, billing plan, etc.).

2. **Registers your bot**
   The current bot (from the `BOT_TOKEN` secret) is added to the registry: `bot:{botId}`, `botmap:{botId} → default`. From this point, requests to `/webhook/{botId}` resolve the tenant by this bot.

3. **Copies all data**
   All keys with prefix **`b:{botId}:`** (users, appointments, state, languages, masters, etc.) are **copied** to keys with prefix **`t:default:`**. Old keys are not deleted — a second copy appears under the new prefix. The worker then reads/writes from `t:default:*`.

4. **Sets a flag**
   `migration:v1:done` is written to KV to prevent re-running (idempotent: a repeated call returns "already done").

## Why it's needed

- **Before migration:** data lives in `b:123456789:lang:...`, `b:123456789:ap:...`, etc. One bot = one prefix.
- **After migration:** same data in `t:default:lang:...`, `t:default:ap:...`. The worker, on a request to `/webhook/123456789`, finds tenant `default` and uses prefix `t:default:`. A second tenant (second salon/bot) can be added later — it will have its own `t:tenant2:` prefix and its own data.

In short: **migration doesn't change your data semantically**, it only introduces "tenants" and moves keys to a new prefix so that a single worker can serve multiple bots with isolation.

## How to run

You need an **ADMIN_KEY** matching the worker secret in Cloudflare.

### If the key is already in .dev.vars

The generated key is written to **.dev.vars** (file is in .gitignore, not committed). For the worker to accept the migration, the **same** key must be in Cloudflare:

1. In Cloudflare: **Workers & Pages** → **manicbot** → **Settings** → **Variables and Secrets** → **ADMIN_KEY** → **Rotate** — paste the value from `.dev.vars` (the `ADMIN_KEY=...` line).
2. In terminal:
   ```bash
   cd manicbot
   npm run migrate
   ```
   The script will pick up `ADMIN_KEY` from `.dev.vars` automatically.

### If the key is not in .dev.vars

- Either copy `.dev.vars.example` to `.dev.vars` and fill in your key.
- Or run with the variable: `ADMIN_KEY=your_key npm run migrate`.

### From the browser

After the key in Cloudflare matches the one in `.dev.vars` (or the one in the URL):

```
https://manicbot.vdovin-kyrylo.workers.dev/admin/migrate?key=KEY_FROM_DEV_VARS
```

Response: `{"ok":true,"copied":N,"message":"..."}` or `{"ok":true,"skipped":true}` if migration was already done.

After migration, update the bot webhook:
https://manicbot.vdovin-kyrylo.workers.dev/setup?key=YOUR_ADMIN_KEY — the response will contain the required URL.

---

### 0010_google_sync_backoff.sql

Adds columns for exponential backoff when syncing with Google Calendar:

```sql
ALTER TABLE appointments ADD COLUMN sync_retries INTEGER DEFAULT 0;
ALTER TABLE appointments ADD COLUMN sync_retry_after INTEGER DEFAULT NULL;
ALTER TABLE appointments ADD COLUMN sync_last_error TEXT DEFAULT NULL;
```

Apply: `npm run migrate` or `GET /admin/migrate?key=ADMIN_KEY`
