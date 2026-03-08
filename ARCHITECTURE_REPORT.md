# Phase 1 — Architecture Analysis: worker.js (Single-Tenant)

## Current architecture

- **Runtime**: Cloudflare Worker, single fetch handler + scheduled (cron).
- **Storage**: One KV namespace (`MANICBOT`). All keys are global; no tenant or bot dimension.
- **Auth**: One `BOT_TOKEN`, one `ADMIN_KEY`, one `WEBHOOK_SECRET`. Admin is Basic Auth (user `admin`, password = `ADMIN_KEY`).
- **Webhook**: Single `POST /webhook`. Bot is identified implicitly by the single token; no routing by bot or tenant.

## Single-tenant assumptions

1. **Single salon config** (hardcoded):
   - `SALON`, `ADDRESS`, `PHONE`, `WORK`, `SVC`, `PHOTOS`, `TIMEZONE` — one set for the whole deployment.
2. **Single bot**: `buildCtx(env)` expects one `BOT_TOKEN`; one Telegram bot per deployment.
3. **Single admin**: One `ADMIN_KEY`, one admin panel at `/admin` showing all data.
4. **No tenant id anywhere**: All KV keys and all logic assume one “salon”; no `tenantId` in keys or in context.

## KV key patterns (current)

| Pattern    | Example           | Purpose                          |
|-----------|-------------------|----------------------------------|
| `u:{chatId}`  | `u:12345`         | User profile (name, phone, etc.) |
| `ua:{chatId}` | `ua:12345`        | List of appointment IDs for user |
| `st:{chatId}`  | `st:12345`        | Booking/registration state      |
| `lang:{cid}`   | `lang:12345`      | User language                    |
| `ap:{id}`      | `ap:a123_xyz`     | Single appointment               |
| `d:{date}`     | `d:2026-03-15`    | Appointment IDs for a day        |
| `all:{yyyy-mm}`| `all:2026-03`     | Appointment IDs for a month      |
| `lock:{cid}:{date}:{time}` | Idempotency lock for booking |

All keys are global: any second “salon” would share the same KV and overwrite/mix data.

## How appointments are stored

- **Per appointment**: `ap:{id}` — object with `chatId`, `svcId`, `date`, `time`, `ts`, `userName`, `userPhone`, `createdAt`, `rem` (reminder flags), `cx` (cancelled).
- **Per user**: `ua:{chatId}` — array of appointment IDs (used to count active and list “my appointments”).
- **Per day**: `d:{date}` — array of appointment IDs (used for slots and reminders).
- **Per month**: `all:{yyyy-mm}` — array of appointment IDs (used for admin list and cleanup).

No tenant or bot id is stored; everything is one logical salon.

## How reminders work

- **Cron**: `scheduled()` runs `handleCron(ctx)` (e.g. every 15 min).
- **Reminders**: For “today” and “tomorrow” dates, cron reads `d:{date}` → for each id reads `ap:{id}` → checks `a.ts` vs now and `a.rem` (h24, h12, h1) → sends up to three reminders (24h, 12h, 1h) via `send(ctx, a.chatId, ...)`.
- **Cleanup**: For current and previous month, reads `all:{yyyy-mm}` → for each id, if appointment is old or cancelled, deletes `ap:{id}` and removes id from `d:{date}` and `all:{yyyy-mm}`.

All reminder/cleanup logic uses global keys; no tenant scope.

## How booking flow works

1. User: /start → language pick or main menu; /book or “Book” → registration if no `u:{chatId}`.
2. After registration: choose service (from global `SVC`) → calendar (dates from `WORK`, `TIMEZONE`) → date → `getSlots(ctx, date, svcId)` (uses `d:{date}` and `ap:*`) → time → confirm.
3. On confirm: idempotency `lock:{cid}:{date}:{time}`; `saveApt(ctx, apt)` writes `ap:`, `ua:`, `d:`, `all:`; send message + ICS + optional admin notify.
4. Cancellation: `cancelApt(ctx, id, ownerChatId)` marks `ap:{id}.cx = true` and updates `ua:`, `d:`, `all:`.

All steps use global config (SALON, ADDRESS, SVC, WORK, PHOTOS) and global KV keys.

## How admin panel works

- **Routes**: `GET /admin` (Basic Auth), `GET /admin/export/clients.csv`, `GET /admin/export/appointments.csv`.
- **Data**: Lists all `u:*` (clients) and all appointments from `all:{month}` for last 3 months. No tenant filter.
- **Setup**: `GET /setup?key=ADMIN_KEY` sets webhook to `{origin}/webhook` for the single bot.

Single “admin” view over the only salon.

## How webhook routing works

- **Single endpoint**: `POST /webhook`.
- **Auth**: `X-Telegram-Bot-Api-Secret-Token` must equal `WEBHOOK_SECRET`.
- **Flow**: Parse JSON → if `message` then `onMsg(ctx, upd.message)`; if `callback_query` then `onCb(ctx, upd.callback_query)`.
- **Context**: One `ctx` from `buildCtx(env)` (one bot, one KV). No resolution of “which bot” or “which tenant”.

## Limitations summary

- Only one salon config per deployment.
- Only one Telegram bot per deployment.
- All data in one KV namespace with no tenant/bot separation → no multi-tenant isolation.
- Admin and cron see “all data” (which is one salon); no notion of tenant or platform admin.
- No roles (client vs master vs tenant_owner vs support); no multi-bot or multi-tenant routing.

## What prevents multi-tenant scaling

1. **No tenant id in keys or context** — cannot separate data per salon/studio/master.
2. **Single bot token and single webhook** — cannot route updates to different bots/tenants.
3. **Hardcoded salon config** — cannot have different SALON/ADDRESS/PHONE/WORK/SVC/PHOTOS per tenant.
4. **Global KV keys** — second tenant would share `u:`, `ap:`, `d:`, `all:` with the first.
5. **Cron and admin** — no iteration over tenants or scoping by tenant; they assume one dataset.

---

## Phase 2–3 (Done) — Tenant model and tenant-scoped KV

- **Tenant model**: `src/tenant.js` — `getTenantConfig(kv, tenantId)`, `tenantConfigKey`, `DEFAULT_TENANT_ID` ('default'). Config: timezone, salonName, address, phone, workHours, services, photos.
- **Keys**: `src/keys.js` — all keys prefixed `tenant:{tenantId}:` (user, ua, st, lang, apt, day, month, lock, members, billing; bot/binding global).
- **Storage**: `src/storage.js` — getState, setState, getUser, saveUser, getLang, setLang, saveApt, cancelApt, getApts, getSlots (all use `ctx.tenantId`).
- **Constants**: `src/constants.js` — CB, VALID_LANGS, MAX_APTS, DEFAULT_TENANT_CONFIG (ex-SALON/ADDRESS/SVC/PHOTOS).
- **worker.js**: Uses `buildCtxWithTenant(env)` so every request has `ctx.tenantId` and `ctx.tenantConfig`. All handlers use tenant config and storage.

**Data migration**: Existing production KV has keys `u:`, `ap:`, `d:`, `all:` (no tenant prefix). New code writes only `tenant:default:...`. To migrate old data to tenant:default keys, run a one-off script or keep a compatibility layer that reads both key patterns during transition.

---

*Next: Phase 4 — Bot registry; Phase 6 — Webhook routing for multiple bots.*
