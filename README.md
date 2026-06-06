# ManicBot

**Multi-tenant Telegram bot for nail salon booking**

A single Cloudflare Worker serves an unlimited number of bots — one per salon. A client messages in Telegram → the bot handles booking, responds via AI, notifies the master, and manages the schedule.

---

## Features

- **Online booking** — choose service, master, date, and time directly in Telegram
- **AI assistant** — Workers AI (gpt-oss-120b, Llama fallbacks) handles free-form dialogue and understands client intent
- **Roles** — system_admin / technical_support / support / tenant_owner / master / client
- **Multi-tenancy** — D1 (primary tenant/bot registry) + KV for state; prefix `t:{tenantId}:`*; legacy mode `b:{botId}:*` with a single `BOT_TOKEN`
- **Unified inbox** — WhatsApp / Instagram (Meta webhooks) merged with Telegram in one conversation view via shared `handlers/inbound.js` → same `onMsg` / `onCb`
- **Billing** — Stripe Checkout and Portal, three plans (Start / Pro / Max)
- **Support** — client↔master tickets and platform tickets client↔support agent
- **Notifications** — cron every 15 min, appointment reminders
- **Email capture & re-conversion** — the bot asks chat clients for their email (after a booking, after first registration, or captures any email they volunteer); consented contacts are owned per-tenant, carry an in-chat unsubscribe, and flow into the marketing automation engine via the `contact.email_captured` trigger
- **Calendar** — ICS file for each appointment; admin dashboard offers Calendar / Agenda / List view modes for appointments (`SalonBigCalendar` month grid + `SalonAgendaView` text-list with Today/Tomorrow/weekday grouping)
- **Master calendar visibility** — masters control peer-to-peer schedule sharing within their tenant via `masters.calendar_visibility` (migration 0049): `private | salon_only | salon_and_peers`. Salon owner always sees regardless.
- **Dashboard chrome** — sticky desktop top bar with theme toggle (sun/moon) and fullscreen toggle (browser Fullscreen API) for "salon OS" mode on reception-desk iPads
- **4-language interface** — RU, UA, EN, PL
- **Management panels** — HTML admin panel for tenants, sysadmin panel for the platform
- **CSV export** — clients and appointments
- **Test accounts** — reproducible 8-account roster (3 salons + 3 masters with annual plans + 1 salon + 1 master with expired trials). See [SEED_TEST_DATA.md](manicbot/SEED_TEST_DATA.md); run `npm run seed:test-accounts` to populate.

> **Parked features** (complete code, hidden on purpose — _not_ dead code): **Marketing → Automations** is finished and its manual "Run Now" works, but it's hidden behind the `MARKETING_AUTOMATIONS_ENABLED` flag in `manicbot/admin-app/src/lib/featureFlags.ts` until the cron trigger-engine is built. The tab is dropped from the marketing sub-nav and the route redirects to `/marketing`. Do not delete the gated code — the unlock runbook is in that flag file.

---

## Stack


| Layer     | Technology                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------- |
| Runtime   | Cloudflare Workers                                                                              |
| Storage   | Cloudflare D1 (SQL) + KV                                                                        |
| AI        | Cloudflare Workers AI (REST, `@cf/openai/gpt-oss-120b`, fallbacks `llama-4-scout-17b` / `llama-3.1-8b`; marketing images `flux-1-schnell`) |
| Billing   | Stripe API                                                                                      |
| Messenger | Telegram Bot API                                                                                |
| Tests     | Vitest 4.x + `@cloudflare/vitest-pool-workers` (Worker ~240 test files); admin-app — separate Vitest |
| Deploy    | Wrangler 4.x → `manicbot.com`                                                                   |


---

## Structure

```
manicbot/
├── src/
│   ├── worker.js              # Entry point: fetch + scheduled (cron) orchestration
│   ├── http/                  # Route handlers (Stripe, admin, Google, TG/Meta webhooks, landing)
│   ├── config.js              # Constants: CB, STEP, DEFAULT_SVC, buildCtx
│   ├── telegram.js            # send(), api() — Telegram Bot API
│   ├── ai.js                  # Prompt, tags [BOOK:…], runWorkersAI, executeAIAction, sanitizeUserInput, validateActionParams
│   ├── i18n.js                # Strings RU / UA / EN / PL
│   ├── patterns.js            # Phrase patterns (cancel, price, consultant)
│   ├── notifications.js       # Notifications to master/admin
│   │
│   ├── tenant/                # Multi-tenancy
│   │   ├── storage.js         # tenant:*, bot:*, botmap:*, listTenantIds
│   │   ├── resolver.js        # resolveTenantFromBotId, buildTenantCtx, buildLegacyCtx
│   │   └── migration.js       # Migration b: → t:default:
│   │
│   ├── roles/
│   │   └── roles.js           # getPlatformRole, getTenantRole, resolveRole, support agents
│   │
│   ├── admin/
│   │   ├── provisioning.js    # createTenant, registerBot, setTenantOwner, addMaster
│   │   └── seed.js            # Seed: 2 salons + services + master
│   │
│   ├── billing/
│   │   ├── config.js          # Stripe keys, price IDs
│   │   ├── stripe.js          # Checkout, Portal, getSubscription
│   │   ├── storage.js         # updateTenantBilling, stripe_customer:*
│   │   └── webhooks.js        # verifyStripeSignature, handleStripeWebhook
│   │
│   ├── support/
│   │   └── tickets.js         # Platform tickets: create, claim, routing
│   │
│   ├── services/
│   │   ├── users.js           # getRole, isAdmin, isMaster, upsertUserFromTelegram
│   │   ├── state.js           # getState, setState, clearState, checkRateLimit
│   │   ├── chat.js            # getLang, setLang, getChatHistory
│   │   ├── services.js        # loadServices, saveServices, about
│   │   ├── appointments.js    # getApts, cancelApt, slots
│   │   ├── tickets.js         # Salon consultant (master↔client)
│   │   └── calendar.js        # ICS generation
│   │
│   ├── handlers/
│   │   ├── message.js         # onMsg: commands, dialog steps, AI
│   │   ├── callback.js        # onCb: inline buttons (booking, admin, tickets)
│   │   ├── inbound.js         # Omnichannel: WA/IG normalization → onMsg/onCb
│   │   └── cron.js            # handleCron: appointment reminders
│   ├── channels/              # Meta adapters, Telegram bridge, ui-renderer
│   │
│   └── ui/
│       ├── screens.js         # welcome, prices, contacts, catalog, myApts
│       ├── booking.js         # Step-by-step booking
│       ├── admin.js           # Tenant panel: appointments, clients, masters
│       ├── sysadmin.js        # Platform panel: tenants, bots, support
│       ├── billing.js         # Stripe Checkout / Portal
│       └── keyboards.js       # mainKb, svcKb
│
├── test/                      # Vitest tests
├── scripts/
│   ├── run-migrate.js         # Migration script b: → t:
│   ├── check-schema-tables.mjs # Table name check schema.sql ↔ Drizzle (npm run check-schema)
│   └── setup-stripe-secrets.sh
├── admin-app/                 # Telegram Mini App (Next.js + tRPC + Drizzle) → Cloudflare Pages
├── wrangler.toml              # Worker config: KV, AI binding, cron, routes
└── package.json
```

---

## Data Architecture

**D1** — appointments, users, tenants, bots, roles, billing, channels, `conversations`, etc. (see `src/db/schema.sql` and `admin-app/src/server/db/schema.ts`; run `npm run check-schema` after migrations).

**KV** (`MANICBOT`) — ephemeral state, locks, encrypted tokens, AI history. Keys:

**Global:**

- `tenant:{tenantId}` — tenant document (plan, billing, stripeCustomerId)
- `bot:{botId}` — bot document (tenantId, webhookSecret, encryptedToken)
- `role:{chatId}` — platform role: `system_admin` / `support`
- `ticket:{ticketId}` — platform support ticket

**Tenant-scoped** (prefix `t:{tenantId}:`)

- `cfg:svc_list` — salon services
- `u:{chatId}` — client profile
- `master:{chatId}` — master profile
- `ap:{aptId}` — appointment
- `state:{chatId}` — current dialog step
- `role:{chatId}` — role within tenant (tenant_owner / master)

---

## Roles


| Role                | Scope    | Permissions                                                                              |
| ------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `system_admin`      | Platform | Full access to everything                                                                |
| `technical_support` | Platform | Platform tech support (Mini App + same God Mode APIs as `support`, via `platform_roles`) |
| `support`           | Platform | Support agents, tickets                                                                  |
| `tenant_owner`      | Tenant   | Salon management, masters, billing                                                       |
| `master`            | Tenant   | Schedule, client appointments                                                            |
| `client`            | Tenant   | Booking, view own appointments                                                           |


---

## Worker Routes

Implementation is split across `src/http/*.js` (see `CLAUDE.md` — modules table; file is gitignored/local).

```
POST /stripe/webhook       → Stripe
GET  /stripe/success       → payment success page
GET|POST /webhook/wa       → WhatsApp Cloud API (verify + HMAC)
GET|POST /webhook/ig       → Instagram Messaging (verify + HMAC)
POST /webhook/:botId       → Telegram (bot registry in D1)
POST /webhook              → Telegram legacy (env BOT_TOKEN); with REQUIRE_WEBHOOK_BOT_ID=1 + D1 → 403
GET  /admin/migrate*       → migrations (ADMIN_KEY)
POST /admin/provision      → bulk bot provisioning (ADMIN_KEY; errors without stack in JSON)
GET  /google/*             → Calendar OAuth
GET  /admin, /admin/billing, /admin/export/* → HTML + CSV (Basic Auth)
GET  /calendar/:id[.ics]   → ICS
GET  /setup, /remove-webhook → Telegram webhook (ADMIN_KEY)
… plus landing proxy to LANDING_URL for selected GET paths
```

Cron: `*/15 * * * *` → `handleCron` per tenant (D1) or legacy context

---

## Quick Start

### Requirements

- Node.js 18+ (via nvm)
- Cloudflare account with Workers and KV
- Telegram Bot Token
- Stripe account (for billing)

### Installation and Deploy

```bash
cd manicbot
npm install

# Set secrets
wrangler secret put BOT_TOKEN
wrangler secret put WEBHOOK_SECRET
wrangler secret put ADMIN_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put WORKERS_AI_API_TOKEN

# Deploy (manual / first deploy). Production deploys run via `git push origin main` → GitHub Actions → Cloudflare.
npx wrangler deploy

# Register bot webhook
curl "https://manicbot.com/setup?key=YOUR_ADMIN_KEY"
```

### Tests

```bash
cd manicbot && npm test && npm run test:ws && npm run check-schema
cd manicbot/admin-app && npm run typecheck && npm test
```

### Register a new tenant (salon)

1. Open sysadmin panel in Telegram: `/sysadmin YOUR_ADMIN_KEY`
2. Register a bot → enter the bot token
3. Assign tenant owner: `/grant_owner @username`

---

## Environment Variables


| Variable                                                          | Where set    | Description                                                                        |
| ----------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------- |
| `MANICBOT`                                                        | wrangler.toml binding | KV namespace binding                                                      |
| `BOT_TOKEN`                                                       | secret       | Telegram Bot Token (legacy/fallback)                                               |
| `WEBHOOK_SECRET`                                                  | secret       | Telegram webhook secret                                                            |
| `ADMIN_KEY`                                                       | secret       | Key for /sysadmin and service endpoints                                            |
| `ADMIN_CHAT_ID`                                                   | secret       | Telegram chat_id of the platform creator                                           |
| `WORKERS_AI_API_TOKEN`                                            | secret       | Token for Workers AI REST API                                                      |
| `CLOUDFLARE_ACCOUNT_ID`                                           | secret       | Cloudflare account ID (Workers AI)                                                 |
| `STRIPE_SECRET_KEY`                                               | secret       | Stripe API key                                                                     |
| `STRIPE_WEBHOOK_SECRET`                                           | secret       | Secret for Stripe webhook verification                                             |
| `STRIPE_PRICE_START_MONTHLY`                                      | secret       | Stripe Price ID for Start plan (monthly)                                           |
| `STRIPE_PRICE_PRO_MONTHLY`                                        | secret       | Stripe Price ID for Pro plan (monthly)                                             |
| `STRIPE_PRICE_MAX_MONTHLY`                                        | secret       | Stripe Price ID for Max plan (monthly)                                             |
| `STRIPE_PRICE_START_ANNUAL`                                       | secret       | Stripe Price ID for Start plan (annual)                                            |
| `STRIPE_PRICE_PRO_ANNUAL`                                         | secret       | Stripe Price ID for Pro plan (annual)                                              |
| `STRIPE_PRICE_MAX_ANNUAL`                                         | secret       | Stripe Price ID for Max plan (annual)                                              |
| `APP_BASE_URL`                                                    | `[vars]`     | Public worker URL (`https://manicbot.com`) — already set in wrangler.toml          |
| `LANDING_URL`                                                     | `[vars]`     | Cloudflare Pages URL for landing proxy — already set in wrangler.toml              |
| `ADMIN_APP_URL`                                                   | `[vars]`     | Cloudflare Pages URL for admin-app proxy — already set in wrangler.toml            |
| `META_APP_ID`                                                     | `[vars]`     | Facebook Login for Business app ID — already set in wrangler.toml                  |
| `META_INSTAGRAM_APP_ID`                                           | `[vars]`     | Instagram Login product app ID — already set in wrangler.toml                      |
| `MARKETING_ASSETS_PUBLIC_URL`                                     | `[vars]`     | R2 public URL for marketing image assets — already set in wrangler.toml            |
| `MARKETING_AUTOPILOT_ENABLED`                                     | `[vars]`     | `"1"` to enable marketing cron autopilot — already set in wrangler.toml            |
| `RETENTION_DRY_RUN`                                               | `[vars]`     | `"1"` for dry-run retention cron (no mutations) — already set in wrangler.toml     |
| `BOT_ENCRYPTION_KEY`                                              | secret       | Encrypts bot tokens in D1/KV; required at startup (set `ALLOW_PLAINTEXT_TOKENS=1` to bypass locally) |
| `BOT_ENCRYPTION_KEY_OLD`                                          | secret       | Previous encryption key — set only during key rotation, unset after                |
| `GOOGLE_OAUTH_CLIENT_ID`                                          | secret       | Google OAuth client ID for Calendar integration                                    |
| `GOOGLE_OAUTH_CLIENT_SECRET`                                      | secret       | Google OAuth client secret for Calendar integration                                |
| `GOOGLE_OAUTH_REDIRECT_URI`                                       | secret       | Google OAuth redirect URI (defaults to `{APP_BASE_URL}/google/callback`)           |
| `GOOGLE_TOKEN_ENCRYPTION_KEY`                                     | secret       | Dedicated AES key for Google refresh tokens (falls back to `BOT_ENCRYPTION_KEY`)  |
| `ANTHROPIC_API_KEY`                                               | secret       | Anthropic API key for marketing caption generation                                 |
| `NOTIFY_TOKEN`                                                     | secret       | Low-privilege Bearer token for `POST /admin/notify` (min 32 chars)                |
| `NOTIFY_BOT_TOKEN`                                                | secret       | Telegram bot token for internal admin notifications (falls back to `BOT_TOKEN`)    |
| `NOTIFY_CHAT_ID`                                                  | secret       | Telegram chat_id for admin notifications (falls back to `ADMIN_CHAT_ID`)          |
| `INTERNAL_API_TOKEN`                                              | secret       | Shared HMAC secret between Worker and admin-app for internal endpoints             |
| `UPLOAD_TOKEN_SECRET`                                             | secret       | HMAC-SHA256 secret for signing short-lived upload tokens                          |
| `WS_TOKEN_SECRET`                                                 | secret       | HMAC secret for signing WebSocket upgrade tokens (`/ws/messenger/{tenantId}`)     |
| `RESEND_API_KEY`                                                  | secret       | Resend transactional email API key                                                 |
| `RESEND_FROM`                                                     | secret       | Resend sender address, e.g. `ManicBot <noreply@manicbot.com>`                      |
| `MARKETING_IG_PAGE_ID`                                            | secret       | Facebook Page ID for marketing autopilot IG posting                               |
| `MARKETING_IG_ACCESS_TOKEN`                                       | secret       | Page access token for marketing autopilot IG posting                              |
| `META_APP_SECRET`                                                 | secret       | Meta app secret for `X-Hub-Signature-256` verification on webhooks                |
| `META_INSTAGRAM_APP_SECRET`                                       | secret       | Instagram Login app secret (separate from `META_APP_SECRET` post Mar-2026)        |
| `META_VERIFY_TOKEN_WA`                                            | secret       | Verify token for WhatsApp webhook handshake                                       |
| `META_VERIFY_TOKEN_IG`                                            | secret       | Verify token for Instagram webhook handshake                                      |
| `REQUIRE_WEBHOOK_BOT_ID`                                          | secret/var   | Optional: `"1"` — reject legacy `POST /webhook` without `botId` when D1 is bound  |
| `ALLOW_PLAINTEXT_TOKENS`                                          | secret/var   | Dev only: `"1"` — bypass `BOT_ENCRYPTION_KEY` requirement; never set in production |
| `WEBHOOK_DEDUP_BACKEND`                                           | secret/var   | Dedup backend: `"kv"` (default), `"d1"`, or `"none"`                               |


---

## Documentation

- `CLAUDE.md` — architecture reference for development (Worker, Mini App, roles, deploy); gitignored/local
- `[BOT_GUIDE.md](manicbot/BOT_GUIDE.md)` — bot user guide
- `[CLOUDFLARE_SETUP.md](manicbot/CLOUDFLARE_SETUP.md)` — Cloudflare setup
- `[STRIPE_SETUP.md](manicbot/STRIPE_SETUP.md)` — billing setup
- `[MIGRATION.md](manicbot/MIGRATION.md)` — migration from legacy to multi-tenant
- `[SEED_TEST_DATA.md](manicbot/SEED_TEST_DATA.md)` — test data

---

## License

Private — all rights reserved.