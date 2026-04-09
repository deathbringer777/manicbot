# ManicBot — Architecture Reference

## Overview

Multi-tenant Telegram bot platform for nail salon booking. Two deployable units:

| Unit | Path | Runtime | Deploy |
|------|------|---------|--------|
| **Worker** | `manicbot/` | Cloudflare Workers | `npx wrangler deploy` |
| **Admin Mini-App** | `manicbot/admin-app/` | Cloudflare Pages (Next.js edge) | git push → GitHub Actions |

---

## Roles

| Role | Scope | Description | Mini-app |
|------|-------|-------------|----------|
| `system_admin` | Platform | Creator (ADMIN_CHAT_ID). Root access to everything. | God Mode dashboard |
| `technical_support` | Platform | Platform tech support. Superset of `support`. | Support dashboard |
| `support` | Platform | Customer support agents. | Support dashboard |
| `tenant_owner` | Tenant | Salon owner. Manages their salon, staff, billing. | Salon dashboard |
| `master` | Tenant | Nail technician. Sees own schedule, clients, earnings. | Master dashboard |
| `client` | — | Default for all users. No mini-app access. | — |

**Important:** `ADMIN_CHAT_ID` (Cloudflare secret) is always God Mode regardless of DB state.
**No "admin_salon" concept** — salon admin = `tenant_owner`.

---

## Storage

| Store | What | Key pattern |
|-------|------|-------------|
| **D1** | Tenants, bots, users, appointments, roles, services, billing, tickets | SQL tables |
| **KV** | User state, locks, encrypted bot tokens, chat history (TTL 1h) | Various prefixes |

KV key patterns:
- `t:{tenantId}:*` — tenant-scoped data
- `b:{botId}:*` — legacy single-bot data
- `state:{cid}` — user conversation state
- `master:{cid}` — master data (KV legacy mode)
- `cfg:admin` — admin chat ID (legacy KV mode)

### Legacy single-bot vs D1 multi-tenant

- **D1 path:** Telegram calls `POST /webhook/{botId}`; `resolveTenantFromBotId` loads tenant + encrypted token from D1. KV prefix `t:{tenantId}:*`.
- **Legacy path:** Single `BOT_TOKEN` + `WEBHOOK_SECRET` in env; `POST /webhook` (no botId in path); `buildLegacyCtx` uses KV prefix `b:{botId}:*`. Used when the bot is not (yet) in the D1 registry or during migration.
- **Stricter production:** set Worker var `REQUIRE_WEBHOOK_BOT_ID=1` when D1 is bound to reject legacy `POST /webhook` (403 — use `/webhook/{botId}` only). Cron and HTML admin routes are unchanged.

### D1 schema discipline

Any change under `manicbot/migrations/` must stay in sync with:

1. `manicbot/src/db/schema.sql` (reference DDL)
2. `manicbot/admin-app/src/server/db/schema.ts` (Drizzle)

Run `npm run check-schema` in `manicbot/` in CI to verify table names and columns match.

Recent migrations:
- `0010_google_sync_backoff.sql` — `sync_retries`, `sync_retry_after`, `sync_last_error` on `appointments`
- `0011_tos_consent.sql` — `tos_accepted_at` on `web_users`
- `0012_web_users_password_reset.sql` — `password_reset_token`, `password_reset_expires_at` on `web_users`
- `0012a_login_attempts.sql` — `login_attempts`, `locked_until` on `web_users`
- `0013_web_users_email_change.sql` — `new_email`, `email_change_token`, `email_change_token_expires_at`, `last_login_ip`, `last_login_at` on `web_users`
- `0014_web_users_lang.sql` — `lang` on `web_users`
- `0015_salon_logo_master_portfolio.sql` — `logo`, `cover_photo` on `tenants`; `portfolio` on `masters`

---

## Worker Architecture (`manicbot/src/`)

```
HTTP request → src/worker.js
  ├─ src/http/*              → match URL first (landing, Stripe, admin keys, Google OAuth, HTML admin, calendar, webhooks)
  ├─ src/http/resolveCtx.js  → getCtx() → tenant/resolver.js (POST /webhook/:botId or legacy /webhook)
  └─ scheduled               → cron per tenant (D1) or legacy ctx
       └─ handlers/message.js, callback.js, inbound.js → onMsg / onCb (Telegram + омниканал)
       └─ handlers/cron.js   ← scheduled tasks (every 15min)
```

### HTTP modules (`src/http/`)

| Module | Routes / role |
|--------|----------------|
| `envCtx.js` | `{ db, kv, globalKv }` helper for handlers |
| `demoBots.js` | Self-provision demo tenants/bots when env secrets `BOT_TOKEN_SALON*` etc. are set |
| `resolveCtx.js` | `getCtx(env, url, request)` — D1 webhook by `botId`, legacy `/webhook`, `REQUIRE_WEBHOOK_BOT_ID` |
| `landingHttp.js` | GET paths proxied to `LANDING_URL` |
| `stripeHttp.js` | `POST /stripe/webhook`, `GET /stripe/success` |
| `adminKeyHttp.js` | `GET /admin/migrate`, `migrate-d1`, `seed`; `POST /admin/provision` (ADMIN_KEY) |
| `googleHttp.js` | `/google/connect`, `callback`, `select`, `webhook` |
| `adminPanelHttp.js` | `GET /setup`, `remove-webhook`, `/admin`, `/admin/billing`, `/admin/export/*` |
| `calendarHttp.js` | `GET /calendar/:aptId[.ics]` |
| `telegramWebhookHttp.js` | `POST /webhook`, `POST /webhook/:botId` (excluding `wa` / `ig`) |
| `metaWebhooksHttp.js` | `GET|POST /webhook/wa`, `GET|POST /webhook/ig` (Meta verify + HMAC) |

### Key Files

| File | Purpose |
|------|---------|
| `src/worker.js` | Entry point; delegates HTTP to `src/http/*.js`; `validateSecurityConfig()` startup checks |
| `src/http/` | Isolated route handlers (see table above) |
| `src/handlers/message.js` | Text message routing, AI chat trigger |
| `src/handlers/callback.js` | Inline button callbacks |
| `src/ai.js` | LLM integration (Cloudflare Workers AI, 3-model fallback) + AI input sanitization (`sanitizeUserInput`, `validateActionParams`) |
| `src/roles/roles.js` | Role CRUD (D1) + helper functions |
| `src/services/users.js` | isAdmin, isCreator, getRole, master CRUD |
| `src/services/appointments.js` | Booking CRUD, slot logic |
| `src/billing/` | Stripe subscriptions, feature gating |
| `src/tenant/resolver.js` | Multi-tenant routing |
| `src/tenant/storage.js` | D1-backed tenant/bot registry |
| `src/support/tickets.js` | Platform support tickets (global KV) |
| `src/services/tickets.js` | Tenant-local support tickets |
| `src/utils/kv.js` | KV helpers — always use `kvGet/kvPut/kvDel` |

### LLM Integration (`src/ai.js`)

- **Models**: `@cf/openai/gpt-oss-120b` → `@cf/meta/llama-4-scout-17b-16e-instruct` → `@cf/meta/llama-3.1-8b-instruct`
- **Two paths**: REST API (`WORKERS_AI_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`) with fallback to `ctx.AI` binding
- **Timeout**: `AbortSignal.timeout(8000)` on each REST fetch; `Promise.race` on each binding call
- **Max tokens**: 280 output, 6000 char prompt, 8 message history (1h TTL)
- **Input sanitization**: `sanitizeUserInput()` strips action-tag patterns (`[TAG:param]` -> `(TAG:param)`) from user text before AI processing. `validateActionParams()` rejects malformed dates/times in AI-extracted tags.
- **Action tags**: AI embeds `[TAG:param]` in responses; bot parses and executes whitelisted actions

---

## Admin Mini-App Architecture (`manicbot/admin-app/`)

**Stack**: Next.js 15 + tRPC 11 + Drizzle ORM + Cloudflare D1 + Tailwind CSS 4

### Auth Flow

```
Telegram Mini App opens
  → TelegramGate.tsx
      → tg.ready() + tg.expand()
      → api.auth.getMyRole.useQuery()  (sends x-telegram-init-data header)
          → server: validateWebAppData() → HMAC verify (constant-time hash compare)
          → check ADMIN_CHAT_ID env → system_admin
          → check platform_roles table → system_admin / support / technical_support
          → check tenant_roles table → tenant_owner / master + tenantId
      → route to correct dashboard by role
```

### Dashboard → Role Mapping

| Role | Dashboard | Component |
|------|-----------|-----------|
| `system_admin` | God Mode | All existing pages (`/`, `/users`, `/tenants`, etc.) |
| `tenant_owner` | Salon Dashboard | `SalonDashboard.tsx` |
| `master` | Master Dashboard | `MasterDashboard.tsx` |
| `support` / `technical_support` | Support Dashboard | `SupportDashboard.tsx` |

### tRPC procedures

- **`publicProcedure`** — no Telegram user required.
- **`protectedProcedure`** — valid `x-telegram-init-data`; sets `ctx.user`.
- **`adminProcedure`** — God Mode: `ADMIN_CHAT_ID` **or** `platform_roles.role` in `system_admin` \| `support` \| `technical_support` (see `server/api/platformRoles.ts` for the single source of truth). Same set is used by `support` router access checks.

### tRPC Routers

| Router | File | Auth |
|--------|------|------|
| `auth` | `routers/auth.ts` | public (validates initData in ctx) |
| `webUsers` | `routers/webUsers.ts` | mixed: public (register, verify, reset) / protected (changePassword, requestEmailChange) / admin (create, list) |
| `publicSalon` | `routers/publicSalon.ts` | public (salon directory: getProfile, search, getCities, autocomplete) |
| `salon` | `routers/salon.ts` | `tenant_owner` for tenantId (`assertTenantOwner`) |
| `master` | `routers/masterRouter.ts` | `master` or `tenant_owner` for tenantId |
| `support` | `routers/support.ts` | platform staff: `support` / `technical_support` / `system_admin` (via `platform_roles`) |
| `channels` | `routers/channels.ts` | protected + `assertTenantOwner` |
| `googleCalendar` | `routers/googleCalendar.ts` | protected + `assertTenantOwner` |
| `conversations` | `routers/conversations.ts` | protected + `assertTenantOwner` |
| `events` | `routers/events.ts` | adminProcedure (getRecent, clear — proxies to Worker) |
| `metrics` | `routers/metrics.ts` | adminProcedure |
| `users` | `routers/users.ts` | adminProcedure |
| `tenants` | `routers/tenants.ts` | adminProcedure |
| `appointments` | `routers/appointments.ts` | adminProcedure |
| `billing` | `routers/billing.ts` | adminProcedure |
| `export` | `routers/export.ts` | adminProcedure |
| `stripe` | `routers/stripe.ts` | adminProcedure |
| `provisioning` | `routers/provisioning.ts` | adminProcedure |
| `settings` | `routers/settings.ts` | adminProcedure |
| `system` | `routers/system.ts` | adminProcedure |

### Key Components

| Component | Purpose |
|-----------|---------|
| `TelegramGate.tsx` | Auth + role-based routing |
| `RoleContext.tsx` | React context: `{ role, tenantId, userId }` |
| `layout/Shell.tsx` | Main layout (sidebar + mobile nav). Accepts `navItems`, `title`, `subtitle` props |
| `dashboards/SalonDashboard.tsx` | Salon owner: Overview, Appointments, Masters, Services, Clients, Billing, Settings |
| `dashboards/MasterDashboard.tsx` | Master: Today, Schedule, Clients, Earnings, Profile |
| `dashboards/SupportDashboard.tsx` | Support: Ticket list + detail + reply + Claim/Escalate/Close |

### Web User Authentication (`server/auth/`, `server/email/`)

Email/password auth for the web admin panel (separate from Telegram Mini App HMAC auth).

```
Browser → (auth)/register → webUsers.register
  → hashPassword (PBKDF2-SHA256, 100k iterations, 16-byte salt)
  → sendVerificationEmail (Resend) → 24h token
  → (auth)/verify-email?token=xxx → webUsers.verifyEmail
  → sendWelcomeEmail (fire-and-forget)

Password reset:
  → (auth)/forgot-password → webUsers.requestPasswordReset → 1h token
  → (auth)/reset-password?token=xxx → webUsers.resetPassword
```

**Key modules:**

| Module | Purpose |
|--------|---------|
| `server/auth/password.ts` | PBKDF2-SHA256 hashing (Web Crypto API, edge-compatible) |
| `server/auth/authBaseUrl.ts` | Resolves public URL for email links (AUTH_URL / NEXTAUTH_URL / VERCEL_URL) |
| `server/email/emailService.ts` | 5 email types: verification, password_reset, welcome, email_change, login_alert |
| `server/email/templates.ts` | Branded HTML templates with i18n (ru/ua/en/pl) |
| `server/email/resend.ts` | Resend HTTP transport (`RESEND_API_KEY`, `RESEND_FROM`) |

**Auth pages** (`app/(auth)/`): `register`, `login`, `forgot-password`, `reset-password`, `verify-email`, `confirm-email-change`

**Security:**
- Rate limiting: 5 attempts / 10 min per IP (in-memory, resets per isolate)
- Brute-force: 5 failed logins → 15-min lockout (`login_attempts`, `locked_until` columns)
- Login alerts: email on new IP (`last_login_ip`, `last_login_at`)
- Password min length: 12 characters
- Constant-time password comparison

---

## Local checks (before deploy)

```bash
cd manicbot/
npm test                     # Worker Vitest (~826 tests)
npm run check-schema         # D1: table + column parity between schema.sql and Drizzle schema.ts

cd admin-app/
npm run typecheck
npm test                     # Mini App Vitest (~20 tests)
```

GitHub Actions `test` job runs the same checks (Worker tests + `check-schema` + admin-app typecheck + tests) before Worker/Pages deploys.

## Deploy

### Worker
```bash
source ~/.nvm/nvm.sh
cd manicbot/
npm test                     # or: npx vitest run
npm run check-schema         # recommended before deploy
npx wrangler deploy          # deploy to Cloudflare Workers
```

**Secrets required** (set via `wrangler secret put <NAME>`):
- `ADMIN_CHAT_ID` — creator's Telegram chat ID (God Mode)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_START_MONTHLY`, `_PRO_MONTHLY`, `_MAX_MONTHLY`
- `CLOUDFLARE_ACCOUNT_ID`
- `WORKERS_AI_API_TOKEN`

**Meta channels** (WhatsApp / Instagram via [`metaWebhooksHttp.js`](manicbot/src/http/metaWebhooksHttp.js)):
- `META_APP_SECRET` — must match the Meta app; required for signed POST webhooks (otherwise 403).
- `META_VERIFY_TOKEN_WA`, `META_VERIFY_TOKEN_IG` — webhook verification; same values on Pages for Mini App hints.
- `BOT_ENCRYPTION_KEY` — recommended (startup `[SECURITY]` warning if missing); decrypts `channel_configs.token_encrypted` for outbound Graph calls. When set, plaintext fallback is disabled for channel tokens.
- Optional: `INSTAGRAM_IGNORE_SENDER_IDS`, `INSTAGRAM_AI_TRIGGER` — see [META_CHANNELS_SETUP.md](manicbot/META_CHANNELS_SETUP.md).

**Outbound Instagram** uses `graph.facebook.com` + Page ID + Page access token ([`channels/instagram.js`](manicbot/src/channels/instagram.js)); **`entry.id`** is matched to `page_id` / `instagram_business_id` / `ig_account_id` in D1 ([`channels/resolver.js`](manicbot/src/channels/resolver.js)).

**IG E2E fixture:** `cd manicbot && npm run ig-e2e:tenant -- --owner=TG_USER_ID --bot-id=BOT_ID` (optional `--dry-run` / `--local`) — see [`META_CHANNELS_SETUP.md`](manicbot/META_CHANNELS_SETUP.md) § «Тестовый тенант для E2E».

**Instagram channel provisioning (new client onboarding):**

```bash
# Create IG channel for existing tenant:
curl -X POST "https://manicbot.com/admin/ig-channel?key=ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "EAAxxxxxxx...",
    "pageId": "1784360123456",
    "tenantId": "t_existing_tenant",
    "igAccountId": "17841437...",
    "instagramBusinessId": "25881183..."
  }'

# Create IG-only tenant (no Telegram bot required):
curl -X POST "https://manicbot.com/admin/ig-channel?key=ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "EAAxxxxxxx...",
    "pageId": "1784360123456",
    "tenantName": "New Salon Name"
  }'
```

To update an existing IG token: `POST /admin/ig-token?key=ADMIN_KEY` with `{ "token": "EAA...", "tenantId": "t_xxx" }`.

**IG-only tenants** are fully supported — `buildChannelCtx` works without a Telegram bot (`ctx.bot = null`, `ctx.TG = null`).

**Billing model:** Clients (regular users) always have free access to the bot (booking, info, catalog). Billing gates (`isInactive`) only restrict staff features (admin panel, master panel, AI, calendar, support). Platform admins (`ADMIN_CHAT_ID` / `system_admin`) always bypass all billing checks.

### Admin Mini-App
```bash
cd manicbot/admin-app/
npm run typecheck && npm test   # optional local gate
# Push to GitHub → GitHub Actions → Cloudflare Pages (project `admin-app`)
```
Deploy job `deploy-admin-app` runs only after the unified `test` job succeeds (includes admin-app typecheck + tests).

**Pages env vars required** (set in Cloudflare Pages dashboard):
- `TELEGRAM_BOT_TOKEN`
- `ADMIN_CHAT_ID` — same value as worker secret
- `RESEND_API_KEY` — Resend API key for transactional emails
- `RESEND_FROM` — sender address (e.g. `ManicBot <noreply@manicbot.com>`)
- `AUTH_URL` — public URL for email links (e.g. `https://admin.manicbot.com`)
- `DATABASE_URL` (optional, for local dev with LibSQL)

---

## D1 Schema Key Tables

| Table | Purpose |
|-------|---------|
| `tenants` | Salon registrations (id, name, plan, billing_status) |
| `bots` | Bot registrations (bot_id, tenant_id, webhook_secret) |
| `tenant_roles` | tenant_owner / master assignments per tenant |
| `platform_roles` | system_admin / support / technical_support (platform-wide) |
| `appointments` | All bookings (tenant-scoped); sync columns: `sync_retries`, `sync_retry_after`, `sync_last_error` |
| `masters` | Master profiles (tenant-scoped) |
| `services` | Service catalog (tenant-scoped) |
| `users` | Client registrations (tenant-scoped) |
| `platform_tickets` | Platform support tickets |
| `platform_ticket_messages` | Messages per platform ticket |
| `local_tickets` | Tenant-local support tickets |
| `tenant_config` | Key-value config per tenant (salon_name, address, work_hours, etc.) |
| `support_agents` | Platform support agents (type: 'support' or 'technical_support') |
| `channel_configs` | WhatsApp / Instagram bindings per tenant |
| `conversations` | Unified inbox rows (омниканал) |
| `message_windows` | Last user message time (WA/IG 24h policy) |
| `google_integrations` | Tenant/master Google OAuth integrations + sync status |
| `google_busy_blocks` | Cached external busy windows loaded from Google Calendar |
| `web_users` | Web panel accounts (email/password auth, verification tokens, brute-force tracking) |

---

## Billing Plans

| Plan | Price | Masters | Features |
|------|-------|---------|---------|
| `start` | 45 zł/mo | 1 | Basic booking |
| `pro` | 60 zł/mo | 5 | AI assistant, support agents, Google Calendar |
| `max` | 90 zł/mo | Unlimited | All features, white label |

Status flow: `trialing` → `active` → `grace` (7-day grace on payment fail) → `expired`

---

## Common Patterns

```js
// Always use KV helpers
import { kvGet, kvPut, kvDel } from '../utils/kv.js';

// Context always has all env vars spread in
const ctx = buildTenantCtx(env, resolved);  // ctx.ADMIN_CHAT_ID, ctx.db, ctx.kv, etc.

// Role check
import { isAdmin, isCreator } from '../services/users.js';
if (await isAdmin(ctx, chatId)) { ... }

// Type-safe chat ID comparison — always String()
String(ctx.adminChatId) === String(cid)
```

## Debugging Bot Silence

When the bot "does not respond", check the context resolution chain in this order:

1. `src/http/resolveCtx.js` / `getCtx()` — D1 tenant/bot resolution for `POST /webhook/{botId}`
2. `buildLegacyCtx(env)` — legacy single-bot fallback for `POST /webhook`
3. `buildCtx(env)` — last-resort fallback when D1/legacy resolution partially fails

Notes:

- `src/worker.js` now logs `[worker] context resolution failed` and `[worker] fallback context build failed` with request path/method and stack, but never serializes the full `ctx`.
- If `REQUIRE_WEBHOOK_BOT_ID=1`, legacy `POST /webhook` is rejected with 403. Use `/webhook/{botId}`.
- If the worker still serves old behavior, confirm the latest local commit is actually deployed.
- For Google OAuth connect URLs from Telegram callbacks, `APP_BASE_URL` must be set on the Worker so the bot can mint absolute `/google/connect` links.
