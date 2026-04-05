# ManicBot — Architecture & Project Structure

> Last updated: 2026-03-29

---

## Project Layout

```
Manicbot_com/
├── manicbot/                      # Cloudflare Worker (bot + API)
│   ├── src/                       # Source code
│   ├── test/                      # 53 test files (~900 tests)
│   ├── migrations/                # D1 SQL migrations
│   ├── wrangler.toml              # Worker configuration
│   └── package.json
├── manicbot/admin-app/            # Next.js Admin Mini-App (Cloudflare Pages)
│   ├── src/                       # Source code
│   └── package.json
├── manicbot-landing/              # Landing page (ARCHIVED — moved to Desktop, see manicbot-analysis/)
├── manicbot-analysis/             # Analysis app
├── _archive/                      # Archived documents
├── docs/                          # Project docs
├── .github/workflows/deploy.yml   # CI/CD pipeline
└── CLAUDE.md                      # Architecture reference
```

---

## Worker Source Tree (`manicbot/src/`)

```
src/
├── worker.js                  Entry point: HTTP routing + scheduled cron + validateSecurityConfig()
│
├── http/                      Route handlers (matched before context resolution)
│   ├── resolveCtx.js          getCtx() — D1 tenant resolution or legacy fallback
│   ├── envCtx.js              Minimal {db, kv, globalKv} for non-bot routes
│   ├── telegramWebhookHttp.js POST /webhook, POST /webhook/:botId
│   ├── metaWebhooksHttp.js    GET|POST /webhook/wa, /webhook/ig (Meta verify + HMAC)
│   ├── stripeHttp.js          POST /stripe/webhook, GET /stripe/success
│   ├── adminKeyHttp.js        /admin/migrate, /admin/provision (ADMIN_KEY protected)
│   ├── adminPanelHttp.js      GET /setup, /admin, /admin/billing, /admin/export/*
│   ├── calendarHttp.js        GET /calendar/:aptId[.ics]
│   ├── googleHttp.js          /google/connect, /callback, /select, /webhook
│   ├── landingHttp.js         Landing page proxy
│   └── demoBots.js            Demo tenant auto-provisioning
│
├── handlers/                  Telegram/channel message handlers
│   ├── message.js             onMsg() — text message routing (1285 lines)
│   ├── callback.js            onCb() — inline button callbacks (1378 lines)
│   ├── cron.js                Scheduled tasks: reminders, billing, calendar sync (exponential backoff)
│   └── inbound.js             Unified InboundMessage dispatcher (all channels)
│
├── services/                  Business logic
│   ├── appointments.js        Booking CRUD, slot availability, time calculations
│   ├── users.js               User/master CRUD, isAdmin/isMaster checks
│   ├── services.js            Service catalog, photos, descriptions
│   ├── calendar.js            Warsaw timezone, slot grid, ICS generation
│   ├── google-calendar-oauth.js Google OAuth + Calendar sync (1018 lines)
│   ├── chat.js                Chat history, language state (KV)
│   ├── state.js               User conversation state + rate limiting (KV)
│   └── tickets.js             Local support ticket state (KV, tenant-scoped)
│
├── channels/                  Multi-channel abstraction layer
│   ├── interface.js           ChannelAdapter abstract interface
│   ├── registry.js            Channel registry + initialization
│   ├── types.js               InboundMessage normalized type
│   ├── telegram.js            TelegramAdapter
│   ├── whatsapp.js            WhatsAppAdapter (Meta Cloud API)
│   ├── instagram.js           InstagramAdapter (Meta Graph API)
│   ├── whatsapp-templates.js  Template message builder
│   ├── token-manager.js       AES-GCM token encrypt/decrypt/refresh
│   ├── resolver.js            Tenant resolution from Meta webhooks
│   ├── ui-renderer.js         Cross-channel UI rendering
│   └── meta-verify.js         HMAC-SHA256 webhook signature verification
│
├── tenant/                    Multi-tenancy
│   ├── resolver.js            Bot→tenant resolution, context builders
│   ├── storage.js             D1 tenant/bot registry + KV token storage
│   └── migration.js           Legacy KV→D1 migration helpers
│
├── roles/
│   └── roles.js               Role CRUD: platform + tenant roles
│
├── billing/                   Stripe integration
│   ├── config.js              Plan limits (start/pro/studio)
│   ├── features.js            Feature gating by plan
│   ├── lifecycle.js           Billing state machine (trial→active→grace→expired)
│   ├── storage.js             Billing D1 operations
│   ├── stripe.js              Stripe API: checkout, portal, customers
│   └── webhooks.js            Stripe event handlers (idempotent, 7-day KV TTL)
│
├── admin/
│   ├── provisioning.js        Role assignment, tenant creation
│   └── seed.js                D1 seeding utilities
│
├── support/
│   └── tickets.js             Platform-level support tickets (D1, global)
│
├── ui/                        Telegram UI builders
│   ├── screens.js             Client views: prices, contacts, catalog
│   ├── keyboards.js           Inline keyboard layouts
│   ├── admin.js               Admin/master panels
│   ├── booking.js             Booking flow UI
│   ├── billing.js             Billing UI panels
│   └── sysadmin.js            Platform admin (God Mode) views
│
├── utils/                     Shared utilities
│   ├── db.js                  D1 wrappers: dbGet, dbAll, dbRun, dbRunSafe, dbBatch
│   ├── kv.js                  KV helpers: kvGet, kvPut, kvDel (always use these)
│   ├── security.js            timingSafeEqual, AES-GCM encrypt/decrypt, randomId
│   ├── helpers.js             i18n loader (L[lang]), escHtml, chatId validation
│   ├── date.js                Warsaw timezone: warsawNow(), warsawToUTC()
│   ├── time.js                Unix seconds: nowSec(), msToSec()
│   ├── ics.js                 ICS calendar file generation
│   └── landing-pages-proxy.js HTTP proxy for landing pages
│
├── i18n/                      Internationalization (4 languages)
│   ├── index.js               L[lang] loader + t(lang, key) helper
│   ├── ru/                    Russian (default + fallback)
│   ├── ua/                    Ukrainian
│   ├── en/                    English
│   └── pl/                    Polish
│       └── admin.js, billing.js, booking.js, gcal.js, general.js, meta.js, support.js...
│
└── db/
    └── schema.sql             D1 reference DDL (kept in sync with Drizzle schema.ts)
```

---

## Admin Mini-App Source Tree (`manicbot/admin-app/src/`)

```
src/
├── app/                           Next.js 15 App Router
│   ├── layout.tsx                 Root layout + providers
│   ├── page.tsx                   Main dashboard router (reads TelegramGate role)
│   ├── login/                     Email/password login page
│   ├── api/auth/[...nextauth]/    Next-Auth route handler
│   ├── api/trpc/[trpc]/           tRPC endpoint
│   ├── appointments/              Admin appointments view
│   ├── billing/                   Revenue dashboard
│   ├── conversations/             Multi-channel unified inbox
│   ├── agents/                    Support agent management
│   ├── settings/                  System settings
│   ├── system/                    System monitoring
│   ├── tenants/                   Tenant management (system_admin)
│   └── users/                     Global user management + banning
│
├── components/
│   ├── TelegramGate.tsx           Auth gate: validates initData, routes by role
│   ├── RoleContext.tsx            React context: { role, tenantId, userId }
│   ├── LangContext.tsx            Language context
│   ├── layout/
│   │   └── Shell.tsx              Main layout: sidebar + mobile nav
│   ├── dashboards/
│   │   ├── SalonDashboard.tsx     Salon owner dashboard (492 lines, post-split)
│   │   ├── MasterDashboard.tsx    Master (nail tech) dashboard
│   │   └── SupportDashboard.tsx   Support agent dashboard
│   └── salon/                     Extracted sub-components for SalonDashboard
│       ├── SalonShared.tsx        Shared: StatCard, AptCard, SectionHeader, Btn, Input
│       ├── SalonCalendarSection.tsx  Google Calendar integration panel
│       └── SalonChannelsTab.tsx   WhatsApp/Instagram channel setup
│
├── server/
│   ├── api/
│   │   ├── trpc.ts                tRPC init: context, procedures
│   │   ├── root.ts                Router aggregation
│   │   ├── platformRoles.ts       Platform role constants (single source of truth)
│   │   ├── tenantAccess.ts        assertTenantOwner() guard
│   │   └── routers/               15 tRPC routers (see table below)
│   ├── auth/
│   │   ├── auth.ts                Next-Auth config (credentials provider)
│   │   ├── telegram.ts            validateWebAppData() — HMAC-SHA256 + 24h expiry
│   │   └── password.ts            Password hashing
│   └── db/
│       ├── schema.ts              Drizzle ORM schema (30+ tables, kept in sync with schema.sql)
│       └── index.ts               Drizzle instance (D1 binding)
│
├── lib/
│   ├── i18n.ts                    Translation system (RU/UA/EN/PL)
│   └── metaChannelHints.ts        WhatsApp/Instagram webhook hints
│
└── trpc/
    ├── react.tsx                  tRPC React provider
    ├── server.ts                  Server-side tRPC caller
    └── query-client.ts            React Query config
```

---

## tRPC Routers

| Router | File | Auth | Purpose |
|--------|------|------|---------|
| `auth` | `routers/auth.ts` | public | Role resolution from initData |
| `salon` | `routers/salon.ts` | `assertTenantOwner` | Salon owner CRUD |
| `master` | `routers/masterRouter.ts` | master/tenant_owner | Master schedule, clients |
| `support` | `routers/support.ts` | platform staff | Ticket management |
| `channels` | `routers/channels.ts` | `assertTenantOwner` | WA/IG channel config |
| `googleCalendar` | `routers/googleCalendar.ts` | `assertTenantOwner` | Calendar integrations |
| `conversations` | `routers/conversations.ts` | `assertTenantOwner` | Unified inbox |
| `metrics` | `routers/metrics.ts` | adminProcedure | Platform metrics |
| `users` | `routers/users.ts` | adminProcedure | Global user management |
| `tenants` | `routers/tenants.ts` | adminProcedure | Tenant management |
| `appointments` | `routers/appointments.ts` | adminProcedure | Admin appointment view |
| `billing` | `routers/billing.ts` | adminProcedure | Revenue metrics |
| `export` | `routers/export.ts` | adminProcedure | Data exports |
| `stripe` | `routers/stripe.ts` | adminProcedure | Stripe management |
| `provisioning` | `routers/provisioning.ts` | adminProcedure | Bot provisioning |
| `settings` | `routers/settings.ts` | adminProcedure | System settings |
| `system` | `routers/system.ts` | adminProcedure | System monitoring |

---

## Role → Dashboard Mapping

```
User opens admin-app
  └── TelegramGate.tsx (or /login for web)
        ├── ADMIN_CHAT_ID match        → system_admin → God Mode (/, /users, /tenants, ...)
        ├── platform_roles: system_admin/support/technical_support → SupportDashboard
        ├── tenant_roles: tenant_owner → SalonDashboard
        ├── tenant_roles: master       → MasterDashboard
        └── client (no roles)          → "No access" screen
```

---

## Data Flow: Telegram Webhook

```
POST /webhook/:botId
  └── resolveCtx.js
        └── resolveTenantFromBotId(db, botId)
              ├── OK → buildTenantCtx(env, resolved)
              └── FAIL → buildLegacyCtx(env) (if REQUIRE_WEBHOOK_BOT_ID != 1)
                    └── FAIL → buildCtx(env) (last resort)

ctx → telegramWebhookHttp.js
  └── verifySecret() — timingSafeEqual(header, WEBHOOK_SECRET)
        └── handleInbound(ctx, inbound)
              ├── [non-blocking] updateMessageWindow / upsertChannelIdentity / upsertConversation
              └── route: onMsg(ctx, msg) OR onCb(ctx, cb)
```

---

## Data Flow: Meta Webhooks (WhatsApp / Instagram)

```
POST /webhook/wa  OR  POST /webhook/ig
  └── metaWebhooksHttp.js
        └── verifyMetaSignature() — HMAC-SHA256 timing-safe
              └── resolver.js: resolveTenantFromWhatsApp/Instagram(db, id)
                    └── buildChannelCtx(env, tenantId, channelConfig, adapter)
                          └── handleInbound(ctx, inbound)
```

---

## Storage Key Patterns

| Pattern | Store | Purpose |
|---------|-------|---------|
| `t:{tenantId}:state:{cid}` | KV | User conversation state |
| `t:{tenantId}:chat:{cid}` | KV | AI chat history (TTL 1h) |
| `t:{tenantId}:lang:{cid}` | KV | User language preference |
| `b:{botId}:*` | KV | Legacy single-bot keys |
| `stripe:evt:{eventId}` | KV | Idempotency (TTL 7 days) |
| `tktlock:{ticketId}` | KV | Ticket claim lock (TTL 10s) |
| `oauth:{sessionId}` | KV | Google OAuth session (TTL 15min) |
| `*` | D1 | All persistent data (tenants, bots, users, appointments, etc.) |

---

## Integration Map

```
ManicBot Worker
  ├── Telegram Bot API (api.telegram.org)
  │     Auth: bot token (D1-encrypted, KV-cached)
  │     Webhooks: POST /webhook/:botId
  │
  ├── Meta (WhatsApp + Instagram)
  │     Auth: Page Access Token (AES-GCM encrypted in D1)
  │     Webhooks: /webhook/wa, /webhook/ig (HMAC-SHA256 verified)
  │     Outbound: graph.facebook.com/v21.0
  │
  ├── Stripe
  │     Auth: STRIPE_SECRET_KEY (Worker secret)
  │     Webhooks: /stripe/webhook (HMAC-SHA256 verified, 7-day idempotency)
  │     Plans: start ($) / pro ($$) / studio ($$$)
  │
  ├── Google Calendar
  │     Auth: OAuth2 refresh token (AES-GCM encrypted in D1)
  │     Sync: bidirectional (Worker push + pull cron every 15min)
  │     OAuth flow: /google/connect → /google/callback → /google/select
  │
  └── Cloudflare Workers AI
        Models: gpt-oss-120b → llama-4-scout-17b → llama-3.1-8b (fallback chain)
        Timeout: 8s per attempt
        Context: 6000 char prompt, 8 messages, 1h TTL
```

---

## D1 Schema Key Tables

| Table | Scope | Purpose |
|-------|-------|---------|
| `tenants` | global | Salon registrations (id, name, plan, billing_status) |
| `bots` | global | Bot registrations (bot_id, tenant_id, webhook_secret) |
| `platform_roles` | global | system_admin / support / technical_support |
| `tenant_roles` | tenant | tenant_owner / master per tenant |
| `appointments` | tenant | All bookings + sync columns: `sync_retries`, `sync_retry_after`, `sync_last_error` |
| `masters` | tenant | Master (nail tech) profiles |
| `services` | tenant | Service catalog |
| `users` | tenant | Client registrations |
| `tenant_config` | tenant | KV-style config (salon_name, address, work_hours) |
| `channel_configs` | tenant | WhatsApp / Instagram channel bindings |
| `conversations` | tenant | Unified inbox rows (омниканал) |
| `message_windows` | tenant | Last user message time (WA/IG 24h policy) |
| `google_integrations` | tenant | Google OAuth integrations + sync status |
| `google_busy_blocks` | tenant | Cached Google Calendar busy windows |
| `platform_tickets` | global | Cross-tenant platform support tickets |
| `local_tickets` | tenant | Tenant-local support tickets |

---

## CI/CD Pipeline

```
git push → GitHub Actions (.github/workflows/deploy.yml)
  └── test job
        ├── npm test (Worker: ~900 Vitest tests)
        ├── npm run check-schema (D1: schema.sql ↔ schema.ts parity)
        ├── tsc --noEmit (admin-app: TypeScript)
        └── npm test (admin-app: ~31 Vitest tests)
              ↓ on success
              ├── deploy-bot → npx wrangler deploy (Cloudflare Workers)
              ├── deploy-landing → Cloudflare Pages (manicbot-landing)
              └── deploy-admin-app → Cloudflare Pages (admin-app via next-on-pages)
```

---

## Billing State Machine

```
trialing ──(trial expires)──→ grace ──(grace expires)──→ expired
    │                                                         │
    └──(Stripe payment)──→ active ──(payment fails)──→ grace ─┘
                              │
                         (cancel)
                              ↓
                          cancelled
```

Staff features gated on billing:
- AI chat (pro/studio)
- Google Calendar sync (pro/studio)
- Multi-master (pro: 5, studio: unlimited)
- Support tickets (all paid plans)

Clients (regular users) always have free access regardless of billing status.
