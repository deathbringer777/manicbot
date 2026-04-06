# ManicBot

**Multi-tenant Telegram bot for nail salon booking**

A single Cloudflare Worker serves an unlimited number of bots — one per salon. A client messages in Telegram → the bot handles booking, responds via AI, notifies the master, and manages the schedule.

---

## Features

- **Online booking** — choose service, master, date, and time directly in Telegram
- **AI assistant** — Workers AI (Llama) handles free-form dialogue and understands client intent
- **Roles** — system_admin / technical_support / support / tenant_owner / master / client
- **Multi-tenancy** — D1 (primary tenant/bot registry) + KV for state; prefix `t:{tenantId}:*`; legacy mode `b:{botId}:*` with a single `BOT_TOKEN`
- **Omnichannel** — WhatsApp / Instagram (Meta webhooks) via shared `handlers/inbound.js` → same `onMsg` / `onCb` as Telegram
- **Billing** — Stripe Checkout and Portal, three plans (Start / Pro / Studio)
- **Support** — client↔master tickets and platform tickets client↔support agent
- **Notifications** — cron every 15 min, appointment reminders
- **Calendar** — ICS file for each appointment
- **4-language interface** — RU, UA, EN, PL
- **Management panels** — HTML admin panel for tenants, sysadmin panel for the platform
- **CSV export** — clients and appointments

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Storage | Cloudflare D1 (SQL) + KV |
| AI | Cloudflare Workers AI (REST, `@cf/meta/llama-3.1-8b-instruct`) |
| Billing | Stripe API |
| Messenger | Telegram Bot API |
| Tests | Vitest 4.x + `@cloudflare/vitest-pool-workers` (Worker ~826 tests); admin-app — separate Vitest |
| Deploy | Wrangler 4.x → `manicbot.com` |

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

| Role | Scope | Permissions |
|---|---|---|
| `system_admin` | Platform | Full access to everything |
| `technical_support` | Platform | Platform tech support (Mini App + same God Mode APIs as `support`, via `platform_roles`) |
| `support` | Platform | Support agents, tickets |
| `tenant_owner` | Tenant | Salon management, masters, billing |
| `master` | Tenant | Schedule, client appointments |
| `client` | Tenant | Booking, view own appointments |

---

## Worker Routes

Implementation is split across `src/http/*.js` (see [CLAUDE.md](CLAUDE.md) — modules table).

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

# Deploy
npx wrangler deploy

# Register bot webhook
curl "https://manicbot.com/setup?key=YOUR_ADMIN_KEY"
```

### Tests

```bash
cd manicbot && npm test && npm run check-schema
cd manicbot/admin-app && npm run typecheck && npm test
```

### Register a new tenant (salon)

1. Open sysadmin panel in Telegram: `/sysadmin YOUR_ADMIN_KEY`
2. Register a bot → enter the bot token
3. Assign tenant owner: `/grant_owner @username`

---

## Environment Variables

| Variable | Description |
|---|---|
| `MANICBOT` | KV namespace binding |
| `BOT_TOKEN` | Telegram Bot Token (legacy/fallback) |
| `WEBHOOK_SECRET` | Telegram webhook secret |
| `ADMIN_KEY` | Key for /sysadmin and service endpoints |
| `ADMIN_CHAT_ID` | Telegram chat_id of the platform creator |
| `WORKERS_AI_API_TOKEN` | Token for Workers AI REST API |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account (Workers AI) |
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Secret for Stripe webhook verification |
| `STRIPE_PRICE_START_MONTHLY` | Stripe Price ID for Start plan |
| `STRIPE_PRICE_PRO_MONTHLY` | Stripe Price ID for Pro plan |
| `STRIPE_PRICE_STUDIO_MONTHLY` | Stripe Price ID for Studio plan |
| `APP_BASE_URL` | Public worker URL (`https://manicbot.com`) |
| `BOT_ENCRYPTION_KEY` | Recommended (startup warning if missing): encrypts bot tokens in D1/KV |
| `REQUIRE_WEBHOOK_BOT_ID` | Optional: `"1"` — reject legacy `POST /webhook` without `botId` when D1 is bound |
| `META_APP_SECRET`, `META_VERIFY_TOKEN_WA`, `META_VERIFY_TOKEN_IG` | For Meta webhooks (see `wrangler` / dashboard) |

---

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — architecture reference for development (Worker, Mini App, roles, deploy)
- [`BOT_GUIDE.md`](manicbot/BOT_GUIDE.md) — bot user guide
- [`CLOUDFLARE_SETUP.md`](manicbot/CLOUDFLARE_SETUP.md) — Cloudflare setup
- [`STRIPE_SETUP.md`](manicbot/STRIPE_SETUP.md) — billing setup
- [`MIGRATION.md`](manicbot/MIGRATION.md) — migration from legacy to multi-tenant
- [`SEED_TEST_DATA.md`](manicbot/SEED_TEST_DATA.md) — test data

---

## License

Private — all rights reserved.
