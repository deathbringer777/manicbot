# ManicBot — Architecture Reference
**Date:** 2026-04-25  
**Produced by:** Architecture & Dead Code sub-agent audit

---

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                CLOUDFLARE EDGE                                          │
│                                                                                         │
│  DNS: manicbot.com / www.manicbot.com                                                   │
│                                ▼                                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐               │
│  │              CLOUDFLARE WORKER  (src/worker.js)                      │               │
│  │  compatibility_date = 2025-01-01                                     │               │
│  │                                                                      │               │
│  │  BINDINGS:                                                           │               │
│  │    DB               → D1 "manicbot-db" (2c9bfdad-...)                │               │
│  │    MANICBOT         → KV (62a7d168-...)                              │               │
│  │    AI               → Workers AI binding                             │               │
│  │    MANICBOT_TENANT_CRON → Queue (producer + consumer)                │               │
│  │    ASSETS           → R2 "manicbot-assets"  [COMMENTED OUT]          │               │
│  │                                                                      │               │
│  │  FETCH HANDLER (URL dispatch order):                                 │               │
│  │  ┌───────────────────────────────────────────────────────────┐       │               │
│  │  │  GET /robots.txt  GET /sitemap.xml                        │       │               │
│  │  │  isAdminAppPath() ──────────────────────────────────────► Pages   │               │
│  │  │  GET/OPT /api/search/*     → trySearchApi()              │       │               │
│  │  │  ensureDemoBotsProvisioned() / ensurePreviewTenant()      │       │               │
│  │  │  GET /demo                 → tryDemoPage()               │       │               │
│  │  │  GET landing paths         → tryLanding() (proxy)        │       │               │
│  │  │  /stripe/*                 → tryStripe()                 │       │               │
│  │  │  /admin/*                  → tryAdminKeyRoutes()         │       │               │
│  │  │  /api/leads, /api/email-subscribe → tryLeadRoutes()      │       │               │
│  │  │  /upload/*, /cdn/*         → tryUpload()  [R2 inactive]  │       │               │
│  │  │  /google/*                 → tryGoogle()                 │       │               │
│  │  │  /webhook/wa /webhook/ig   → tryMetaWebhooks()           │       │               │
│  │  │  /chat/*                   → tryChatWeb()                │       │               │
│  │  │  /embed/*                  → tryEmbed()                  │       │               │
│  │  │  [resolve tenant ctx from D1 or legacy env]              │       │               │
│  │  │  /setup /remove-webhook /admin /admin/billing            │       │               │
│  │  │  /admin/export/*           → tryAdminPanel() (HTML UI)   │       │               │
│  │  │  /calendar/:aptId[.ics]    → tryCalendar()               │       │               │
│  │  │  POST /webhook/:botId      → tryTelegramWebhook()        │       │               │
│  │  │  GET * (fallback)          → tryLanding() (force)        │       │               │
│  │  └───────────────────────────────────────────────────────────┘       │               │
│  │                                                                      │               │
│  │  SCHEDULED HANDLER (cron: */15 * * * *):                            │               │
│  │    D1 tenants → Queue fan-out (MANICBOT_TENANT_CRON)                 │               │
│  │    Queue consumer → handleCron(ctx) per tenant                       │               │
│  │                                                                      │               │
│  └──────────────────────────────────────────────────────────────────────┘               │
│         │ proxyToAdminApp()           │ D1 queries      │ KV ops                        │
│         ▼                            ▼                  ▼                               │
│  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐                    │
│  │ Cloudflare Pages │   │  D1 Database     │   │  KV Namespace    │                    │
│  │ admin-app        │   │  manicbot-db     │   │  MANICBOT        │                    │
│  │ (Next.js 15)     │   │  SQLite D1       │   │                  │                    │
│  │                  │   │  35+ tables      │   │  state:{cid}     │                    │
│  │  /login          │   │  tenants         │   │  chat:{cid}      │                    │
│  │  /register       │   │  bots            │   │  lang:{cid}      │                    │
│  │  /dashboard/*    │   │  users           │   │  master:{cid}    │                    │
│  │  /tenants        │   │  appointments    │   │  gcal:oauth:*    │                    │
│  │  /salon/*        │   │  masters         │   │  stripe:evt:*    │                    │
│  │  /api/trpc/*     │   │  services        │   │  adminlog:recent │                    │
│  │  (Drizzle → D1)  │   │  platform_roles  │   │  rl:search:{ip}  │                    │
│  │                  │   │  tenant_roles    │   │  tktlock:*       │                    │
│  │  32 tRPC routers │   │  web_users       │   │  dedup:meta:*    │                    │
│  └──────────────────┘   │  marketing_*     │   └──────────────────┘                    │
│                         │  plugin_*        │                                            │
│                         │  rate_limits     │                                            │
│                         │  channel_configs │                                            │
│                         └──────────────────┘                                            │
│                                                                                         │
│  QUEUE: manicbot-tenant-cron                                                            │
│    producer (scheduled) → enqueues {tenantId, scheduledAt}                             │
│    consumer (queue)     → handleCron(ctx) per tenant | DLQ: manicbot-tenant-cron-dlq   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Request Flows

### Telegram Webhook
```
Telegram API → POST /webhook/{botId}
  → tryTelegramWebhook()
  → verifySignature (X-Telegram-Bot-Api-Secret-Token, timingSafeEqual)
  → dedup via D1 (update_id)
  → resolveTenantFromBotId(D1) → buildTenantCtx()
  → handleInbound() → onMsg / onCb
  → send() → https://api.telegram.org/bot{token}/sendMessage
```

### Meta (WhatsApp / Instagram) Webhook
```
Meta Platform → POST /webhook/wa or POST /webhook/ig
  → tryMetaWebhooks()
  → verifyMetaSignature(META_APP_SECRET, X-Hub-Signature-256)
  → resolveTenantFromWhatsApp / resolveTenantFromInstagram (D1)
  → WhatsAppAdapter / InstagramAdapter
  → buildChannelCtx() → handleInbound()
```

### Admin Dashboard
```
Browser → manicbot.com/dashboard/*
  → Worker: isAdminAppPath() → proxyToAdminApp(ADMIN_APP_URL)
  → Cloudflare Pages (Next.js edge runtime)
  → /api/trpc/* → tRPC router → Drizzle ORM → D1
```

### Web Chat Widget
```
Landing page → /embed/demo-chat.js  (served by Worker)
Widget POST  → /chat/init → POST /chat/send → GET /chat/poll
  → resolveTenantFromSlug(D1) → WebAdapter
  → handleInbound() → replies in HTTP response body
```

### Cron Fan-Out
```
Cloudflare Scheduler (*/15 min)
  → Worker.scheduled()
  → listTenantIds(D1) → MANICBOT_TENANT_CRON.sendBatch()
  → Queue consumer: handleCron(ctx) per tenant (full CPU budget)
  → on error: msg.retry({ delaySeconds: min(60 * attempts, 300) })
  → DLQ after 3 retries
```

---

## Multi-Tenancy Model

```
D1 "bots":     bot_id → tenant_id   (many bots per tenant)
D1 "tenants":  plan, billing_status, is_personal
D1 "channel_configs": WA/IG bindings per tenant

POST /webhook/{botId}
  → resolveTenantFromBotId() → loads tenant + decrypts bot token from KV
  → buildTenantCtx() → all env vars + tenant data in ctx

Legacy (single-bot env var):
  BOT_TOKEN + WEBHOOK_SECRET in env
  → POST /webhook (no botId)
  → buildLegacyCtx()

Production lockdown:
  REQUIRE_WEBHOOK_BOT_ID=1 → 403 on legacy POST /webhook
```

---

## LLM Integration

```
src/ai.js
  Models (fallback chain):
    1. @cf/openai/gpt-oss-120b
    2. @cf/meta/llama-4-scout-17b-16e-instruct
    3. @cf/meta/llama-3.1-8b-instruct

  Two execution paths:
    - REST API: WORKERS_AI_API_TOKEN + CLOUDFLARE_ACCOUNT_ID, AbortSignal.timeout(8000)
    - ctx.AI binding: Promise.race with 8s timeout

  Limits: 280 output tokens, 6000 char prompt, 8 message history (1h KV TTL)
  
  Safety:
    - sanitizeUserInput(): strips [TAG:param] action patterns from user text
    - validateActionParams(): rejects malformed dates/times in AI-extracted tags
    - System prompt injected tenant context (name, address, services, work hours)
```

---

## HTTP Modules (`src/http/`)

| Module | Routes | Purpose |
|--------|--------|---------|
| `envCtx.js` | — | `{ db, kv, globalKv }` helper |
| `resolveCtx.js` | — | `getCtx()` — D1 or legacy webhook routing |
| `landingHttp.js` | `GET *` | Proxy to `LANDING_URL` (Cloudflare Pages SPA) |
| `stripeHttp.js` | `POST /stripe/webhook`, `GET /stripe/success` | Billing lifecycle |
| `adminKeyHttp.js` | `GET/POST /admin/*` | 12 key-authenticated admin endpoints |
| `adminPanelHttp.js` | `/setup`, `/remove-webhook`, `/admin`, `/admin/billing` | Legacy HTML admin panel (Basic Auth) |
| `googleHttp.js` | `/google/connect`, `/google/callback`, `/google/select`, `POST /google/webhook` | Google Calendar OAuth |
| `calendarHttp.js` | `GET /calendar/:aptId[.ics]` | ICS file (HMAC-signed URL) |
| `telegramWebhookHttp.js` | `POST /webhook`, `POST /webhook/:botId` | Telegram inbound |
| `metaWebhooksHttp.js` | `GET/POST /webhook/wa`, `GET/POST /webhook/ig` | WhatsApp + Instagram |
| `chatWebHttp.js` | `POST /chat/init`, `POST /chat/send`, `GET /chat/poll` | Web chat widget API |
| `embedHttp.js` | `GET /embed/demo-chat.js` | Embeddable widget JS |
| `demoPageHttp.js` | `GET /demo` | iPhone mockup demo page |
| `leadsHttp.js` | `POST /api/leads`, `POST /api/email-subscribe` | Landing lead capture |
| `searchHttp.js` | `GET /api/search/*` | Public CORS salon search |
| `uploadHttp.js` | `POST /upload/asset`, `GET /cdn/*` | R2 upload **[INACTIVE — R2 not bound]** |
| `adminAppProxy.js` | All dashboard paths | Routes to Pages (isAdminAppPath predicate) |

---

## Admin Mini-App tRPC Routers (32 total)

| Router | Auth | Purpose |
|--------|------|---------|
| `auth` | public | Role resolution (Telegram HMAC or web session) |
| `webUsers` | mixed | Registration, verification, password, Google OAuth |
| `publicSalon` | public | Salon directory, search, profile |
| `salon` | tenant_owner | Salon management, services, branding, connectBot |
| `master` / `masterRouter` | master/owner | Schedule, clients, earnings, personal tenant CRUD |
| `support` | platform staff | Ticket management (claim/escalate/close) |
| `channels` | tenant_owner | WA/IG channel config |
| `conversations` | tenant_owner/admin | Unified inbox |
| `googleCalendar` | tenant_owner | OAuth connect, sync status |
| `appointments` | adminProcedure | Platform-wide appointment view |
| `billing` | adminProcedure | Stripe billing management |
| `events` | adminProcedure | Activity feed ring buffer |
| `marketing` | adminProcedure | CRM contacts, segments, templates, campaigns |
| `plugins` | adminProcedure | Plugin marketplace |
| `tenantStaff` | protectedProcedure | Phase 2 staff management |
| `system` | adminProcedure | Health grid |
| `provisioning` | adminProcedure | Agent add/remove |
| `users` | adminProcedure | Platform user list |
| `tenants` | adminProcedure | Platform tenant list |
| `settings` | adminProcedure | Platform settings |
| `metrics` | adminProcedure | Platform metrics |
| `export` | adminProcedure | Data export (CSV) |
| `leads` | adminProcedure | Landing leads |
| `analytics` | adminProcedure | Referral/signup charts |
| `promoCodes` | adminProcedure | Promo code validation |
| `stampCard` | adminProcedure | Loyalty stamp cards |
| `reviews` | mixed | Public reviews |
| `roleChangeRequests` | protectedProcedure | Role change request flow |
| `onboarding` | protectedProcedure | Onboarding checklist |
| `search` | adminProcedure | God Mode cross-table fuzzy search |
| `tenantStaff` | protectedProcedure | Phase 2 staff/permission management |

---

## Dead Code

### Never Imported
| File | Description |
|------|-------------|
| `src/utils/circuitBreaker.js` | Full KV-backed circuit breaker — zero callers in entire codebase |

### Dead Exports
| Module | Dead Exports |
|--------|-------------|
| `src/utils/kv-keys.js` | 21 of 22 exports unused (codebase uses inline string literals); only `ticketFwdAckKey` is live |

### Inactive Infrastructure
| Item | File | Status |
|------|------|--------|
| R2 asset bucket | `wrangler.toml:73-78` | Commented out — `uploadHttp.js` returns 500 when not bound |
| `/stripe` route alias | `admin-app/src/app/(dashboard)/stripe/page.tsx` | 3-line re-export of BillingPageClient — dead duplicate of `/billing` |

### Duplicate Logic (Intentional / Architectural)

| Pattern | Locations | Reason |
|---------|-----------|--------|
| Rate limiter | `src/utils/rateLimit.js` + `admin-app/src/server/auth/rateLimit.ts` | Different ORMs required |
| Search normalization | `src/lib/searchNormalize.js` + `admin-app/src/lib/searchNormalize.ts` | Different runtimes |
| Support tickets | `src/support/tickets.js` (global) + `src/services/tickets.js` (tenant) | Different scopes |
| Blog article list | `src/http/searchHttp.js` + `admin-app/src/content/blog/articles.ts` | Must stay in sync manually |

---

## Half-Built Features

| Feature | Backend | Frontend | Missing |
|---------|---------|----------|---------|
| Marketing campaigns | Full DB + tRPC | StubCard "Phase 2" | Email/SMS fan-out engine, scheduling cron |
| R2 Asset Upload | `uploadHttp.js` complete | `AssetUploadField.tsx` ready | `wrangler r2 bucket create manicbot-assets` + uncomment binding |
| Tenant Manager role | `tenantStaff.ts` + DB schema | `StaffTab.tsx` | Nav route, role assignment flow, elevation code email |
| SMS sending | `sendBrevoSms()` implemented | `SmsClient.tsx` | No tRPC procedure calls it; Brevo dormant |
| Returning-client promo | Analytics event only | UI present | Follow-up job to create promo codes |

---

## Plugin Marketplace

30 first-party plugins across 6 role buckets (5 universal). Compile-time modules in `plugins/<slug>/`.

```
plugins/<slug>/
  manifest.ts      — PluginManifest (required)
  router.ts        — optional tRPC sub-router
  lifecycle.ts     — optional install/uninstall hooks
  health.ts        — optional health check
  worker.ts        — optional Worker-side logic
  ui/SettingsPanel.tsx — optional settings UI
```

**Billing models:** `free | included_in_plan | paid_addon_monthly | paid_addon_onetime`

**Lock precedence (catalog UI):** `coming_soon > role_mismatch > platform_only > plan > none`

**Paid addon flow:** `POST /admin/plugin-addon-checkout` → Stripe Checkout → `price.metadata.plugin_slug` routes the webhook → `plugin_installations.billing_state`

---

## Billing Plans

| Plan | Price | Masters | Features |
|------|-------|---------|----------|
| `start` | 45 zł/mo | 1 | Basic booking |
| `pro` | 60 zł/mo | 5 | AI assistant, support agents, Google Calendar |
| `max` | 90 zł/mo | Unlimited | All features, white label |

**Status flow:** `trialing → active → grace (7-day on payment fail) → expired`

Billing gates (`isInactive`) restrict **staff features only** (admin panel, master panel, AI, calendar, support). Clients always have free booking access.

---

## Key Design Decisions

1. **Single Worker, multi-tenant via D1** — `bot_id → tenant_id` routing; encrypted tokens per bot; `REQUIRE_WEBHOOK_BOT_ID=1` disables legacy path in production.

2. **No Durable Objects** — All per-request state via D1 + KV. Tradeoff: no strong linearizability on slot locks (KV is eventually consistent), mitigated by short TTL + double-check pattern.

3. **Async cron via Queue** — Decouples cron scheduling (fast Producer: list tenants, enqueue) from cron execution (Consumer: full CPU budget per tenant). DLQ after 3 retries with exponential backoff.

4. **Admin-app proxied through Worker** — All `isAdminAppPath()` routes proxy to Pages. Allows Worker to add security headers, rewrite redirect locations, and maintain a single domain.

5. **HKDF domain separation** — One `BOT_ENCRYPTION_KEY` derives separate subkeys per domain (bot tokens, calendar HMAC, Google tokens). Prevents cross-domain key reuse attacks. Format: `v1$` prefix → HKDF path; no prefix → legacy direct key (lazy migration).

6. **Web session isolation** — `isWebSessionLocked(ctx, chatId)` prevents synthetic chat IDs (web widget users) from matching real Telegram chat IDs in role lookups — defense against web-to-admin role escalation.
