# ManicBot — Full Code Review Report
**Date:** 2026-04-25  
**Scope:** Worker (`src/`), Admin-App (`admin-app/src/`), CI/CD, Plugins, Marketing  
**Method:** 5 parallel sub-agents + direct inspection + live test runs

---

## Executive Summary

ManicBot is a well-engineered multi-tenant Telegram bot platform with strong fundamentals: HKDF-based token encryption, constant-time auth comparisons, D1-backed rate limiting, comprehensive test coverage, and proper tenant isolation on all critical paths. The codebase is production-ready at its core.

**10 bugs were fixed during this review.** 2 critical bugs that would cause runtime 500s are now resolved. Several medium/high security issues remain (see SECURITY_FINDINGS.md).

---

## Fixes Applied in This Review

| ID | Severity | File | Description | Status |
|----|----------|------|-------------|--------|
| B10 | CRITICAL | `src/http/adminKeyHttp.js:421-425` | Wrong module imports in `reject` appointment action — `'../utils/lang.js'` (non-existent), `'../utils/time.js'` (no `fmtDT`), `'../services/services.js'` (no `svcName`) | **FIXED** |
| B7 | HIGH | `src/utils/security.js` + `src/utils/rateLimit.js` | Admin rate limiter incremented on every request including successes, locking out legitimate admins after 5 total calls | **FIXED** |
| B1 | HIGH | `src/handlers/callback.js:1440` | KV slot lock key not scoped to master — concurrent bookings for different masters at same slot serialized on one lock | **FIXED** |
| B2 | HIGH | `src/handlers/callback.js:1451,1443` | `getSlots()` confirmation double-check did not pass `masterId` — slot availability checked against all masters, not selected master | **FIXED** |
| DC1 | MEDIUM | `src/services/appointments.js:15-17` | `dayIndexKey()` accepted `masterId` parameter but ignored it, returning `d:${date}` for all masters | **FIXED** |
| B3 | LOW | `src/ai.js:326` | `role === 'tenant_owner'` appeared twice in BILLING tag check | **FIXED** |
| B4 | LOW | `src/ai.js:345` | Same duplicate in BOOK_FOR_CLIENT tag check | **FIXED** |
| B5 | LOW | `src/handlers/message.js:174` | `isSalonStaff` had duplicate `tenant_owner` check | **FIXED** |
| — | LOW | `src/handlers/message.js:861` | Ternary `cancellerRole === 'tenant_owner' \|\| cancellerRole === 'tenant_owner'` — both arms identical | **FIXED** |
| — | LOW | `src/handlers/callback.js:260` | `isSalonStaffSupport` had duplicate `tenant_owner` | **FIXED** |
| Test | LOW | `admin-app/src/__tests__/plugins-pinned.test.tsx:51` | `localStorage.clear()` not implemented in happy-dom — 18 tests were failing | **FIXED** (prev session) |

---

## Remaining Bugs (Not Fixed — Lower Priority)

### B6 — Post-visit and review-request flows share overlapping tracking columns
- **File:** `src/handlers/cron.js:385`
- `processPostVisitConfirmations` writes `review_requested_at`; Phase 1.5 review-request cron uses a separate `review_requested` column. The two flows are divergent but use overlapping semantics — confusing for future maintainers.
- **Recommendation:** Add a dedicated `visit_prompt_sent_at` column to clearly separate the two flows.

### B8 — Stripe `checkout.session.completed` sets billing to `active` even during trial
- **File:** `src/billing/webhooks.js:157-165`
- When a trial completes checkout, `billingStatus` is set to `'active'` immediately. A subsequent `customer.subscription.updated` with `status: 'trialing'` corrects it, but creates a brief inconsistency window.
- **Recommendation:** Check `session.subscription` status before overriding `billingStatus`.

### B11 — `checkAndIncrement` is not atomic (TOCTOU race)
- **File:** `src/utils/rateLimit.js:29-51`
- Read → compute → write without a transaction. Under concurrent Workers, two requests can both read `count=0`, both write `count=1`, bypassing the rate limit.
- **Recommendation:** Use `INSERT OR REPLACE INTO rate_limits ... WHERE count < limit` conditional write, or accept the acceptable-risk-in-context behavior for a 15-min window.

### B12 — `stamp_card_configs` / `stamp_card_progress` tables may not exist
- **File:** `src/handlers/callback.js:213-228`
- Queries wrapped in `try/catch` silently swallow errors if tables are absent. These tables are not present in `schema.sql` or any migration file found in `migrations/0002–0038`.
- **Recommendation:** Verify and add migration if stamp card is active; otherwise remove the dead code path.

### T3 — Returning-client promo code never actually created
- **File:** `src/handlers/cron.js:422-426`
- Comment says "delegated to follow-up worker job" but no such job exists. Only an analytics event is written.

---

## Architecture Overview

See `ARCHITECTURE.md` for the full diagram. Key points:
- Single Cloudflare Worker handles all HTTP, scheduled (cron), and queue consumer paths
- Multi-tenant via D1 `bots` table (`bot_id → tenant_id`) + per-tenant encrypted tokens
- Admin Mini-App on Cloudflare Pages (Next.js 15 edge + tRPC 11 + Drizzle)
- Queue fan-out for cron: `*/15 * * * *` → enqueue per-tenant messages → consume with full CPU budget

---

## Dead Code Summary

| Item | File | Status |
|------|------|--------|
| `circuitBreaker.js` | `src/utils/circuitBreaker.js` | Never imported anywhere — safe to delete |
| `kv-keys.js` (21/22 exports) | `src/utils/kv-keys.js` | All except `ticketFwdAckKey` unused — codebase uses inline literals |
| `/stripe/page.tsx` | `admin-app/src/app/(dashboard)/stripe/page.tsx` | 3-line re-export of BillingPageClient — dead route alias |
| `brevo.ts` | `admin-app/src/server/email/brevo.ts` | DORMANT per PROVIDERS.md — never called by email service |
| `ADMIN_APP_URL` fallback | `src/worker.js:33` | Internal Pages URL `admin-app-3nc.pages.dev` exposed in source |

---

## Half-Built Features

| Feature | Backend | Frontend | Blocker |
|---------|---------|----------|---------|
| Marketing campaigns | Full DB schema + tRPC CRUD | StubCard "Phase 2" | No email/SMS fan-out execution engine |
| R2 Asset Upload | `uploadHttp.js` complete | `AssetUploadField.tsx` ready | R2 binding commented out in `wrangler.toml` |
| Tenant Manager role | Full `tenantStaff.ts` router | `StaffTab.tsx` ready | No nav route; role never assigned |
| SMS sending | `sendBrevoSms()` implemented | `SmsClient.tsx` shows status | No tRPC procedure calls it |
| Returning-client promo | Analytics event only | Birthday promo UI | Follow-up job never created |

---

## Test Coverage Summary

| Area | Estimated Coverage | Notes |
|------|--------------------|-------|
| KV helpers, logger, security | 90–95% | Exhaustive unit tests |
| Billing lifecycle, Stripe webhooks | 90% | All event types + idempotency |
| Tenant isolation, role escalation | 90% | Multi-tenant, role-escalation tests |
| AI sanitizer, action parsing | 85% | Unicode bypass attacks tested |
| Appointments (service layer) | 80% | Slot conflict, booking flow |
| Telegram webhook HTTP | 80% | HMAC validation, dedup |
| `handlers/message.js` | 25% | **Gap** — no direct onMsg tests |
| `handlers/callback.js` | 20% | **Gap** — no onCb business-logic tests |
| `src/worker.js` entry routing | 40% | Excluded from coverage config |
| Admin-app tRPC routers | 65–75% | Most paths covered via unit tests |

**Critical untested paths:**
1. Full booking flow via `onMsg` + `onCb` integration
2. Google OAuth token refresh failure path
3. `REQUIRE_WEBHOOK_BOT_ID=1` enforcement
4. WhatsApp outbound template 24h-window enforcement
5. Trial expiry cron (`billing/lifecycle.js`)

---

## Hardcoded Values to Address

| Location | Value | Risk |
|----------|-------|------|
| `src/config.js` | Polish defaults (address, phone, timezone, salon name) | Used as fallback — will appear in reminders if tenant config empty |
| `src/worker.js:33` | `https://admin-app-3nc.pages.dev` | Internal URL in source |
| `src/handlers/cron.js:374, 465` | Hardcoded Russian post-visit and birthday messages | Not localized via i18n |
| `src/handlers/callback.js:165,174,229,197` | Several Russian strings hardcoded | Not in i18n system |

---

## Duplicate Logic (Acceptable — Architectural)

| Duplication | Locations | Reason |
|-------------|-----------|--------|
| Rate limiter | `src/utils/rateLimit.js` + `admin-app/src/server/auth/rateLimit.ts` | Worker can't use Drizzle; admin-app avoids raw SQL — intentional |
| Search normalization | `src/lib/searchNormalize.js` + `admin-app/src/lib/searchNormalize.ts` | Different runtimes — keep in sync manually |
| Blog article list | `src/http/searchHttp.js` + `admin-app/src/content/blog/articles.ts` | New articles need adding in 2 places |

---

## CI/CD Pipeline

The GitHub Actions pipeline at `.github/workflows/deploy.yml` is solid:
- `security-scan` (Gitleaks full history + Semgrep OWASP) → `test` → `deploy`
- Admin-app typecheck + tests block deploy
- `npm audit --audit-level=high` runs for both worker and admin-app

**Missing:**
- No coverage reporting (`--coverage` flag absent)
- No E2E or Miniflare integration tests
- `deploy-landing` job is permanently disabled (`if: false`)
