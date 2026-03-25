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

---

## Worker Architecture (`manicbot/src/`)

```
Telegram webhook → src/worker.js
  └─ tenant/resolver.js  → resolves tenantId + bot from URL or env
  └─ buildTenantCtx(env, resolved)  → ctx with all env + D1 + KV
       └─ handlers/message.js   ← text messages
       └─ handlers/callback.js  ← button callbacks
       └─ handlers/cron.js      ← scheduled tasks (every 15min)
```

### Key Files

| File | Purpose |
|------|---------|
| `src/worker.js` | Entry point, routing, provisioning endpoints |
| `src/handlers/message.js` | Text message routing, AI chat trigger |
| `src/handlers/callback.js` | Inline button callbacks |
| `src/ai.js` | LLM integration (Cloudflare Workers AI, 3-model fallback) |
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
          → server: validateWebAppData() → HMAC verify
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

### tRPC Routers

| Router | File | Auth |
|--------|------|------|
| `auth` | `routers/auth.ts` | public (validates initData in ctx) |
| `salon` | `routers/salon.ts` | verifies `tenant_owner` for tenantId |
| `master` | `routers/masterRouter.ts` | verifies `master` or `tenant_owner` for tenantId |
| `support` | `routers/support.ts` | verifies `support`/`technical_support`/`system_admin` |
| `metrics` | `routers/metrics.ts` | adminProcedure |
| `users` | `routers/users.ts` | adminProcedure |
| `tenants` | `routers/tenants.ts` | adminProcedure |
| `appointments` | `routers/appointments.ts` | adminProcedure |
| `billing` | `routers/billing.ts` | adminProcedure |
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

---

## Deploy

### Worker
```bash
source ~/.nvm/nvm.sh
cd manicbot/
npx vitest run               # run tests (672 tests)
npx wrangler deploy          # deploy to Cloudflare Workers
```

**Secrets required** (set via `wrangler secret put <NAME>`):
- `ADMIN_CHAT_ID` — creator's Telegram chat ID (God Mode)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_START_MONTHLY`, `_PRO_MONTHLY`, `_STUDIO_MONTHLY`
- `CLOUDFLARE_ACCOUNT_ID`
- `WORKERS_AI_API_TOKEN`

### Admin Mini-App
```bash
cd manicbot/admin-app/
# Push to GitHub → GitHub Actions → Cloudflare Pages auto-deploy
```

**Pages env vars required** (set in Cloudflare Pages dashboard):
- `TELEGRAM_BOT_TOKEN`
- `ADMIN_CHAT_ID` — same value as worker secret
- `DATABASE_URL` (optional, for local dev with LibSQL)

---

## D1 Schema Key Tables

| Table | Purpose |
|-------|---------|
| `tenants` | Salon registrations (id, name, plan, billing_status) |
| `bots` | Bot registrations (bot_id, tenant_id, webhook_secret) |
| `tenant_roles` | tenant_owner / master assignments per tenant |
| `platform_roles` | system_admin / support / technical_support (platform-wide) |
| `appointments` | All bookings (tenant-scoped) |
| `masters` | Master profiles (tenant-scoped) |
| `services` | Service catalog (tenant-scoped) |
| `users` | Client registrations (tenant-scoped) |
| `platform_tickets` | Platform support tickets |
| `platform_ticket_messages` | Messages per platform ticket |
| `local_tickets` | Tenant-local support tickets |
| `tenant_config` | Key-value config per tenant (salon_name, address, work_hours, etc.) |
| `support_agents` | Platform support agents (type: 'support' or 'technical_support') |

---

## Billing Plans

| Plan | Masters | Features |
|------|---------|---------|
| `start` | 1 | Basic booking |
| `pro` | 5 | AI chat, Google Calendar |
| `studio` | Unlimited | All features |

Status flow: `trialing` → `active` → `grace` (3-day grace on payment fail) → `expired`

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
