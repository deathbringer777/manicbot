# Manicbot Codebase Audit — 2026-04-23

## Executive Summary

Manicbot is a well-structured, actively developed multi-tenant SaaS platform with two deployable units: a Cloudflare Worker (the bot + API backend) and a Next.js 15 Admin Mini-App (the web dashboard). The codebase shows strong security fundamentals — constant-time comparisons, CSP with nonces, HMAC-signed upload tokens, D1-backed rate limiting, Zod input validation throughout, and tenant isolation enforced at every router. The architecture is solid and the Worker test suite (~100+ test files) is unusually thorough for a project of this size.

The biggest risk area is the **Marketing module**, which is intentionally shipped as a Phase 1 skeleton — five of seven sub-pages are stubs with no real send functionality, yet they are deployed to production under a `system_admin` guard. Equally notable is a **`UploadKind` type mismatch**: the admin-app's `uploadToken.ts` does not include `"service_photo"` in its allowed-kinds set even though both `SalonDashboard` and `MasterDashboard` pass `kind: "service_photo"` to `mintUploadToken`, causing silent failures or token rejection when users upload service photos.

The second risk area is **code quality at scale**: `SalonDashboard.tsx` is 1,810 lines; `MasterDashboard.tsx` is 874 lines; both contain large amounts of inline JSX with duplicated constants (STATUS_LABELS, APT_BORDER, NAIL_EMOJIS, relativeTime) copied verbatim into at least four separate files. The dashboard pages have acceptable loading states but inconsistent Suspense usage — only the `/settings` route wraps its client component in a `<Suspense>` boundary.

The Worker is JavaScript (not TypeScript), which means type safety, refactoring, and IDE tooling are degraded for the core booking/AI logic. This is a structural concern rather than an immediate bug risk given the test coverage.

Recommended fix priorities: (1) patch the `service_photo` UploadKind mismatch immediately; (2) add Suspense boundaries to all dashboard `page.tsx` → `*PageClient.tsx` routes; (3) extract duplicated appointment display constants into a shared library; (4) complete or clearly gate the Marketing module stubs.

---

## 1. Codebase Structure

### Directory Map

```
/
├── CLAUDE.md, README.md, TEST_ACCOUNTS.md, MULTI_BOT_SETUP.md  (root docs)
├── archive/          — miniapp/ subdirectory (old Telegram Mini App code)
├── manicbot/
│   ├── src/          — Cloudflare Worker (JavaScript, ~40 files)
│   │   ├── admin/    — HTML admin panel handlers
│   │   ├── billing/  — Stripe billing + plugin webhooks
│   │   ├── channels/ — Telegram, WhatsApp, Instagram adapters
│   │   ├── handlers/ — message.js, callback.js, cron.js, inbound.js
│   │   ├── http/     — 18 route handlers
│   │   ├── plugins/  — (also root manicbot/plugins/)
│   │   ├── services/ — appointments, users, tickets, upload
│   │   ├── tenant/   — multi-tenant resolver, storage
│   │   └── utils/    — kv.js, events.js, logger.js, seo.js, ...
│   ├── plugins/      — 30 first-party plugin modules
│   ├── migrations/   — 36 SQL migration files (0000–0035)
│   ├── test/         — ~100 Worker Vitest test files
│   ├── scripts/      — seed, schema check, rotation scripts
│   └── admin-app/    — Next.js 15 Admin App
│       └── src/
│           ├── app/(auth)/       — 6 auth routes
│           ├── app/(dashboard)/  — 17 dashboard routes + layout
│           ├── app/(public)/     — salon directory, blog, help, rules
│           ├── components/       — ~80 component files in 12 subdirs
│           ├── server/api/routers/ — 30 tRPC routers
│           └── __tests__/        — ~65 admin-app test files
```

### Findings

**[MEDIUM] (S) Duplicate route: `/dashboard/page.tsx` re-exports `DashboardClient`; `/page.tsx` (root) does the same via `DashboardClient.tsx`.** Both `(dashboard)/page.tsx` and `(dashboard)/dashboard/page.tsx` export the same `DashboardClient`. The `/stripe/page.tsx` route re-exports `BillingPageClient`. These duplicates exist as Cloudflare Pages routing workarounds (CF Pages routes the `(dashboard)/*` path group to the public layout → 404). The workaround is documented in `layout.tsx` via `GOD_TAB_COMPONENTS` but it also means some routes are effectively dead (`/appointments`, `/tenants`, etc. resolve to the same dashboard on Pages). This is a structural debt, not a bug, but creates confusion.
- Files: `admin-app/src/app/(dashboard)/dashboard/page.tsx`, `admin-app/src/app/(dashboard)/stripe/page.tsx`

**[MEDIUM] (S) `archive/` folder contains old Telegram Mini App code** that is superseded by the web admin app. It is not gitignored and occupies disk space.
- Path: `/Users/vdovin/Desktop/Manicbot_com/archive/miniapp/`

**[LOW] (S) `manicbot/admin-app/db.sqlite` is a local dev database file.** It is gitignored (confirmed via `.gitignore`) but present on disk. Contains empty schema data — not a data leak risk but could be accidentally committed if `.gitignore` is modified.
- File: `admin-app/db.sqlite` (69 KB, 12 DB pages, SQLite 3.45)

**[LOW] (S) Worker is 100% JavaScript, not TypeScript.** ~40 source files in `manicbot/src/` use `.js`. Type safety, IDE autocomplete, and refactoring confidence are significantly reduced. No `@ts-check` pragmas. The admin-app is fully TypeScript.

**[LOW] (S) `manicbot/src/http/landingHttp.js` contains several `console.log` debug calls** (lines 58, 102, 108, 133) related to iframe screen detection. These fire in production on every landing proxy request.
- File: `manicbot/src/http/landingHttp.js:58,102,108,133`

---

## 2. Documentation

### All `.md` Files (excluding `node_modules`)

- `/README.md` — top-level overview
- `/MULTI_BOT_SETUP.md`
- `/TEST_ACCOUNTS.md`
- `/CLAUDE.md` — architecture reference (comprehensive, up to date)
- `manicbot/BILLING.md`
- `manicbot/BOT_GUIDE.md`
- `manicbot/CLOUDFLARE_SETUP.md`
- `manicbot/GOOGLE_CALENDAR_SETUP.md`
- `manicbot/LANDING_DEMO_INTEGRATION.md`
- `manicbot/META_CHANNELS_SETUP.md`
- `manicbot/MIGRATION.md`
- `manicbot/SEED_TEST_DATA.md`
- `manicbot/STRIPE_SETUP.md`
- `manicbot/docs/LOGPUSH_SETUP.md`
- `manicbot/plugins/README.md`
- `manicbot/plugins/AUTHORING.md`
- `manicbot/plugins/SECURITY.md`
- `manicbot/admin-app/README.md`
- `manicbot/admin-app/src/server/email/PROVIDERS.md`

### Findings

**[MEDIUM] (S) `admin-app/README.md` says auth uses `x-telegram-init-data` HMAC, but this has been removed.** The README states: "Auth: `x-telegram-init-data` header, HMAC verification in `src/server/auth/telegram.ts`". The `trpc.ts` comment explicitly says "The legacy Telegram Mini App path (x-telegram-init-data HMAC) has been removed in Phase 1." The auth now uses NextAuth email/password sessions. The README is stale and would mislead new developers.
- File: `admin-app/README.md` (all auth references)

**[LOW] (S) `CLAUDE.md` references `auth.getMyRole` returning `{ role, tenantId, masterId, isPersonalTenant }` via Telegram initData** in multiple places, but `auth.getMyRole` now uses NextAuth sessions. The CLAUDE.md architecture section under "Auth Flow" still shows the Telegram HMAC flow diagram. This is confusing for contributors.
- File: `CLAUDE.md` (Auth Flow section)

**[LOW] (S) No `CHANGELOG.md` or version history file.** Given the platform has 36 migrations and ~170+ commits since the recent "Phase 1" work, tracking what changed between deployments relies entirely on git log.

---

## 3. Dashboard Quality

This is the most critical section. All findings are in `manicbot/admin-app/src/`.

### 3a. Stub / Incomplete Pages

**[HIGH] (M) Marketing module (5/7 sub-pages) are Phase 1 stubs deployed to production.**
The following pages render `<StubCard>` components with "Phase 1 skeleton" badges visible to users. The badges say things like "Отправка (fan-out через Brevo/Resend) — Phase 2":
- `app/(dashboard)/marketing/automations/AutomationsClient.tsx` — purely static list of planned triggers, no DB interaction
- `app/(dashboard)/marketing/campaigns/CampaignsClient.tsx` — only lists campaigns; create/send is stubbed
- `app/(dashboard)/marketing/sms/SmsClient.tsx` — status display only; notes "Billing gate — Phase 3"
- `app/(dashboard)/marketing/templates/TemplatesClient.tsx` — list only; no create/edit/delete
- `app/(dashboard)/marketing/providers/ProvidersClient.tsx` — display only

The `MarketingShell.tsx` `ComingSoonBadge` component explicitly labels these as "Phase 1 skeleton". These pages are under `adminProcedure` (system_admin only) but the "coming soon" UI is still user-facing.

**[MEDIUM] (S) `(api as any).marketing.*` casts in marketing pages** bypass TypeScript inference entirely, meaning breaking API changes won't be caught at build time.
- Files: `CampaignsClient.tsx:8`, `SmsClient.tsx:8`, `TemplatesClient.tsx:8`, `LeadsPageClient.tsx:44-54`

**[LOW] (S) `(public)/salon/[slug]/SalonProfileClient.tsx` has a `{/* Rating placeholder */}` comment** indicating an unfilled UI slot for aggregate salon ratings.
- File: `app/(public)/salon/[slug]/SalonProfileClient.tsx:306`

### 3b. Missing Loading / Skeleton States

**[HIGH] (M) No `<Suspense>` boundary on most dashboard page routes.** Only `/settings/page.tsx` wraps its `SettingsPageClient` in a `<Suspense>` boundary. All other 16 dashboard route files (`page.tsx`) use either `export { default } from "...Client"` or render a client component directly — no Suspense wrapping, no `loading.tsx` files in any route segment. This means initial page loads show an uncontrolled flash of empty content on route transitions within the Cloudflare Pages SPA.

Confirmed absence of Suspense: `/users`, `/tenants`, `/appointments`, `/billing`, `/agents`, `/events`, `/system`, `/conversations`, `/channels`, `/leads`, `/marketing/*`, `/plugins`, `/role-requests`.

**[MEDIUM] (S) `MasterDashboard` earnings tab lacks a skeleton** — it shows a bare `<Loader2>` spinner while the data loads, unlike the reviews tab which has a pulse skeleton. Similarly the `clients` and `schedule` tabs use a raw spinner.
- File: `components/dashboards/MasterDashboard.tsx:307,327,366`

**[MEDIUM] (S) `ConversationsClient` conversation list shows no loading skeleton** on initial load — just a centered `<Loader2>` with no height placeholder, causing layout shift.
- File: `app/(dashboard)/conversations/_components/ConversationsClient.tsx:159`

### 3c. Missing Error Boundaries

**[MEDIUM] (S) Only one `error.tsx` exists at the `(dashboard)` route group level.** There are no nested `error.tsx` files for individual routes like `/marketing`, `/plugins`, `/conversations`, `/channels`. A tRPC error in any sub-section will bubble to the shared dashboard error boundary, showing a full-page "Something went wrong" screen instead of inline error recovery.
- File: `app/(dashboard)/error.tsx` (only boundary that exists)

**[LOW] (S) `error.tsx` calls `console.error("[dashboard-error]", error)` in production** — this leaks full stack traces to browser console in production.
- File: `app/(dashboard)/error.tsx:10`

### 3d. Missing Empty States

**[MEDIUM] (S) `TenantsPageClient` has no "no results" UI for filtered tenant list.** When search/filter returns zero results, the component renders an empty list with no empty-state message.
- File: `app/(dashboard)/tenants/TenantsPageClient.tsx` (no empty state in filtered results)

**[LOW] (S) `ConversationsClient` shows "No conversations found" but provides no CTA** to start a conversation or check channel configuration.
- File: `app/(dashboard)/conversations/_components/ConversationsClient.tsx:163-168`

### 3e. Pagination Gaps

**[MEDIUM] (M) `TenantsPageClient` fetches ALL tenants with `api.tenants.getAll`** — no pagination, no limit in the tRPC query. The `tenantsRouter.getAll` query returns every tenant with `ORDER BY created_at DESC` and no `LIMIT`. At scale (1000+ tenants) this will cause slow loads and potential D1 query timeouts.
- Files: `app/(dashboard)/tenants/TenantsPageClient.tsx:133`, `server/api/routers/tenants.ts:8-45`

**[MEDIUM] (S) `LeadsPageClient` hardcodes `limit: 100, offset: 0`** with no pagination controls. The `leads.list` query supports offset but the client never increments it.
- File: `app/(dashboard)/leads/LeadsPageClient.tsx:44`

**[LOW] (S) `ConversationsClient` shows "Scroll for more" text but no actual load-more button** when `nextCursor` is present.
- File: `app/(dashboard)/conversations/_components/ConversationsClient.tsx:254-256`

### 3f. Inconsistent Design System / Duplicate Code

**[HIGH] (L) Massive component duplication: `STATUS_LABELS`, `APT_BORDER`, `STATUS_STYLES`, `NO_SHOW_LABELS`, `CANCELLED_BY_LABELS`, `AptRow` are defined identically in three places:**
1. `components/dashboards/MasterDashboard.tsx` (lines 21-54)
2. `components/master/tabs/TodayTab.tsx` (lines 8-55)
3. `components/dashboard-ui/AptCard.tsx` (exported via `SalonShared.tsx`)

`relativeTime()` is defined identically in `SupportDashboard.tsx` and `HelpSection.tsx`.
`NAIL_EMOJIS` is defined in `SalonDashboard.tsx` and `MasterDashboard.tsx` (embedded inline in `MasterDashboard` as a literal array in the emoji picker code).

**[HIGH] (L) `SalonDashboard.tsx` is 1,810 lines; `MasterDashboard.tsx` is 874 lines.** Both are monolithic "God components" containing tab navigation, data fetching, forms, modals, and all rendering logic in a single file. This makes testing, code review, and partial re-renders difficult. The salon dashboard has 13 tabs (overview, appointments, masters, services, clients, billing, channels, reviews, settings, public_profile, analytics, promo_codes, staff) all rendered inline via `tab === "..."` conditionals.

**[MEDIUM] (M) Service creation form is duplicated between `SalonDashboard` (`ServiceModal`) and `MasterDashboard` (inline form).** Both implement the same emoji picker, photo upload, promo sticker, name/price/duration fields — separately. `ServiceModal` in SalonDashboard uses `SalonShared.Input`; MasterDashboard uses raw `<input>` elements with identical styling classes.
- Files: `components/dashboards/SalonDashboard.tsx:42-400`, `components/dashboards/MasterDashboard.tsx:480-630`

**[MEDIUM] (S) `MasterDashboard` has hardcoded Russian-only labels** for STATUS_LABELS ("Подтверждено", "Ожидает", etc.) and uses `t()` for some strings but not these status labels. The reviews tab uses hardcoded English ("No reviews yet", "Salon reply", "Reviews").
- File: `components/dashboards/MasterDashboard.tsx:28-46, 395, 419`

**[MEDIUM] (S) Mixed language in UI strings.** `SupportDashboard` uses hardcoded Russian for `relativeTime()` ("только что", "мин назад", "ч назад", "д назад") but the rest of the app supports 4 languages via `t()`.
- File: `components/dashboards/SupportDashboard.tsx:26-32`

### 3g. Accessibility Issues

**[HIGH] (M) Tab bar buttons in `MasterDashboard` and `SalonDashboard` have no `aria-selected`, `role="tab"`, or `role="tabpanel"` ARIA attributes.** Both dashboards use `<button>` elements for tab navigation without marking them as tabs.
- Files: `components/dashboards/MasterDashboard.tsx:283-296`, `components/dashboards/SalonDashboard.tsx` (tab bar)

**[MEDIUM] (S) Modal dialogs in `SalonDashboard` (ServiceModal, MasterModal, etc.) have `role="dialog"` and `aria-modal="true"` but are missing `aria-labelledby`.** Focus is not trapped inside modals when opened — keyboard users can navigate outside.
- File: `components/dashboards/SalonDashboard.tsx:107,274,353`

**[MEDIUM] (S) Appointment cards in `MasterDashboard` use `<div>` for the "no-show" action instead of a button with a label.** The parent card is not keyboard-navigable.
- File: `components/dashboards/MasterDashboard.tsx:88-118` (`AptRow` component)

**[LOW] (S) `TenantsPageClient` CopyBtn has no `aria-label`** — assistive technologies see a button with an icon only.
- File: `app/(dashboard)/tenants/TenantsPageClient.tsx:86-99`

### 3h. Form Validation Issues

**[MEDIUM] (S) `MasterDashboard` service form validates only client-side with a silent no-op** (`if (!svcForm.names.trim() || isNaN(price) || isNaN(duration)) return;`) — no error message is displayed to the user when validation fails.
- File: `components/dashboards/MasterDashboard.tsx:603-608`

**[LOW] (S) Portfolio URL input in `MasterDashboard` accepts any string** — no URL format validation beyond what Enter-key adds. Users can save invalid non-HTTP URLs.
- File: `components/dashboards/MasterDashboard.tsx:763-769`

### 3i. UX Flow Issues

**[MEDIUM] (S) `platform-support/page.tsx` uses a `useEffect` + `router.replace` for access control** instead of server-side middleware. This causes a flash of the loading spinner before redirect for unauthorized roles.
- File: `app/(dashboard)/platform-support/page.tsx`

**[LOW] (S) `MasterDashboard` reviews tab uses hardcoded `"Reviews"` as the tab label** in `tabLabels` object while all other tabs use `t()`.
- File: `components/dashboards/MasterDashboard.tsx:243`

---

## 4. Security Gaps

### 4a. Upload Kind Mismatch (Critical)

**[CRITICAL] (S) `UploadKind` type in `admin-app/src/server/lib/uploadToken.ts` does not include `"service_photo"`**, but both `SalonDashboard` and `MasterDashboard` call `mintUploadToken({ tenantId, kind: "service_photo" })`. The worker-side `manicbot/src/services/upload.js` DOES include `"service_photo"` in `ALLOWED_KINDS`. This means:
- The tRPC `mintUploadToken` procedure will throw "invalid kind: service_photo" when called, because `signUploadToken` validates against `ALLOWED_KINDS` which only has `logo|cover|photo|portfolio`.
- Service photo uploads silently fail for all tenants.

Fix: Add `"service_photo"` to the `UploadKind` type and `ALLOWED_KINDS` set in `admin-app/src/server/lib/uploadToken.ts`.
- Files: `admin-app/src/server/lib/uploadToken.ts:14-22`, `components/dashboards/SalonDashboard.tsx:82`, `components/dashboards/MasterDashboard.tsx:594`

### 4b. In-Memory Rate Limiting (Isolate Reset Risk)

**[HIGH] (M) `roleChangeRequests.ts` uses an in-memory `Map` for rate limiting** that resets on every Cloudflare Workers isolate cold-start or scale-out. This means the 3-requests-per-10-min limit is per-isolate, not platform-wide. Under scale-out, an attacker can send many more requests.
- File: `admin-app/src/server/api/routers/roleChangeRequests.ts:14-28`
- Note: All other sensitive endpoints (register, verify, reset-password, email-change) use the proper D1-backed `checkRateLimit` from `server/auth/rateLimit.ts`. Only `roleChangeRequests` uses the in-memory version.

### 4c. Tenant Isolation

**[MEDIUM] (M) `assertMaster` in `masterRouter.ts` does not verify that `masterId` in the input matches the authenticated user's masterId.** The `getMySchedule`, `getMyAppointments`, `getMyClients`, and `getMyEarnings` procedures accept `masterId: z.number()` from the client and only check that the caller is "a master on that tenant" — not that the caller IS that specific master. A tenant_owner (who passes the `assertMaster` check) could query any masterId's schedule by passing a different `masterId`.
- File: `admin-app/src/server/api/routers/masterRouter.ts:60-72` (`getMySchedule` and similar)

### 4d. CSP / Headers

**[LOW] (S) Worker `addSecurityHeaders` does not set `Permissions-Policy` header**, while the admin-app middleware does. The worker serves HTML admin panels and the salon profile HTML pages — those should also get `Permissions-Policy`.
- File: `manicbot/src/worker.js:78-88`

**[LOW] (S) `connect-src` in admin-app CSP (`middleware.ts`) hardcodes `https://*.manicbot.com`** — if deployed under a different domain (staging, white-label) the CSP will block tRPC calls and break the app.
- File: `admin-app/src/middleware.ts:41`

### 4e. Input Sanitization

**[LOW] (S) `masterRouter.ts` calls `sanitizeText` on bio and `description` fields but not on `photo` URL.** A malicious tenant_owner or master could set `photo` to a JavaScript URL (`javascript:...`) which would be embedded in a `<img src>` tag on the public salon profile.
- File: `admin-app/src/server/api/routers/masterRouter.ts` (updateProfile procedure)
- Mitigated partially because `img src` with `javascript:` doesn't execute, but see also `portfolio` array — portfolio URLs are stored as-is.

### 4f. File Upload Security

**[LOW] (S) Upload handler in the Worker validates MIME by file extension only** (via `ALLOWED_MIME` map keyed on `Content-Type` header). A client could set `Content-Type: image/png` while uploading a non-PNG file. No magic-bytes check.
- File: `manicbot/src/services/upload.js`

---

## 5. Code Quality

### 5a. TypeScript `any` Casts

**[MEDIUM] (M) Heavy `as any` usage across dashboard components.** Confirmed 185 occurrences of `as any` / `: any` across 47 files in `admin-app/src`. Notable clusters:
- `MasterDashboard.tsx` — 22 occurrences (profile data, apt data, service data)
- `SalonDashboard.tsx` — 14 occurrences (review/service/master data)
- `SupportDashboard.tsx` — 4 occurrences
- `LeadsPageClient.tsx` — 9 occurrences (all tRPC calls cast as `(api as any)`)
- `masterRouter.ts:9,18` — `ctx: any` in auth helper functions

The `(api as any).marketing.*` pattern in marketing pages is particularly dangerous — it bypasses TypeScript's tRPC router type inference entirely.

### 5b. Dead / Stub Code

**[MEDIUM] (S) `roleQuery.data.isTest` is fetched but never propagated to `ctxValue`** in the dashboard `layout.tsx`. The `RoleContext.Provider` `ctxValue` object does not include `isTest`. Components read `useRole().isTest` which returns `undefined` (default `false`). The `isTest` flag is correctly read in `MasterDashboard` via `useRole().isTest` — but the context never sets it, so the yellow TEST badge in MasterDashboard never fires.
- File: `admin-app/src/app/(dashboard)/layout.tsx:82` (missing `isTest` in ctxValue construction)

### 5c. Large Files / God Components

**[HIGH] (L) `SalonDashboard.tsx` (1,810 lines) contains 13 tabs** with inline rendering, 6+ modals, all mutation hooks, image upload logic, calendar display, Recharts analytics, and Google Calendar integration. This violates single-responsibility and makes it impossible to test individual tabs in isolation.

### 5d. N+1 and Query Patterns

**[LOW] (S) `tenants.getAll` fetches ALL tenants, ALL bots, ALL user counts, ALL appointment counts, ALL master counts** in 5 parallel queries. For a small platform this is fine, but at 10,000+ tenants and 100,000+ appointments, this will time out. There are no pagination parameters.
- File: `admin-app/src/server/api/routers/tenants.ts:8-45`

**[LOW] (S) `auth.getMyRole` makes 3-4 DB round-trips on every request** (webUsers, tenants, masters, permissions). Since this is called on every page load via `api.auth.getMyRole.useQuery()`, it executes frequently. Candidate for caching with `staleTime`.

### 5e. Inconsistent Patterns

**[MEDIUM] (S) `SalonDashboard` service form uses `SalonShared.Input` component; `MasterDashboard` service form uses raw `<input>` elements with inline Tailwind classes.** Same form, two different implementations.

**[MEDIUM] (S) `UploadKind` type is defined in two places with divergent values.** `admin-app/src/server/lib/uploadToken.ts` exports `"logo"|"cover"|"photo"|"portfolio"`. The worker's `manicbot/src/services/upload.js` has `"logo"|"cover"|"photo"|"portfolio"|"service_photo"`. These are supposed to stay in lockstep per the comment ("Mirror of... token format must stay in lockstep") but have drifted.

### 5f. Missing Error Handling

**[MEDIUM] (S) `auth.getMyRole` wraps all DB calls in `try { ... } catch { /* non-critical */ }`.** If the DB is unavailable, the user gets a null role and is silently redirected to login rather than seeing a meaningful error.
- File: `admin-app/src/server/api/routers/auth.ts:55-102`

**[LOW] (S) `MasterDashboard` photo upload error handler uses `alert()`** — inconsistent with the rest of the UI which uses inline error states.
- File: `components/dashboards/MasterDashboard.tsx:597` (`catch { alert("Ошибка загрузки фото"); }`)

---

## 6. Test Coverage

### Worker Tests (`manicbot/test/`) — 103 test files

**Coverage is excellent for the Worker layer.** Key paths covered:
- Auth, roles, billing lifecycle, appointments, AI sanitization, multi-tenant isolation, Google Calendar sync with backoff, meta webhooks, schema-column parity, plugin system, rate limiting, encryption enforcement, all HTTP handlers.

**[MEDIUM] (S) No test file for `src/http/uploadHttp.js` that validates the `service_photo` kind** — the `upload-http.test.js` and `upload-service.test.js` exist but were not verified to include `service_photo` in the kind test matrix (given the mismatch identified in §4a).
- File: `manicbot/test/upload-http.test.js`, `manicbot/test/upload-service.test.js`

**[LOW] (S) `manicbot/test/leads-http.test.js` exists but `LeadsPageClient` does not have admin-app unit tests.** The Worker-side lead HTTP endpoint is tested but the admin-app `leads` router is untested in `__tests__/`.

### Admin-App Tests (`admin-app/src/__tests__/`) — ~65 test files

**Coverage is good for auth, plugins, billing, security, and tRPC routers.**

**[HIGH] (M) No tests for the Marketing module router (`marketing.ts`).** The marketing router has 356 lines and handles contact management, campaign CRUD, template CRUD, and send operations. Zero test coverage.
- Missing file: `__tests__/marketing.test.ts`

**[MEDIUM] (M) No tests for `MasterDashboard` or `SalonDashboard` components.** These are the primary user-facing dashboards (1,810 + 874 lines) but have no unit tests. Only `google-calendar-runtime.test.tsx` tests a dashboard-adjacent plugin runtime.

**[MEDIUM] (S) No tests for `tenantStaff.ts` router** (530 lines covering tenant_manager invitation, permission management, elevation codes). This is a security-sensitive router with email sending and permission escalation logic.
- Missing file: `__tests__/tenantStaff.test.ts`

**[LOW] (S) No tests for `conversations.ts` router** (169 lines) or `channels.ts` router (138 lines).

**[LOW] (S) No integration tests for the Marketing module's stub paths** — it's unknown if the `stub: true` responses are handled gracefully by the UI.

---

## Recommended Execution Order

### Session 1 — Critical Bug Fix (S)
**Fix `service_photo` UploadKind mismatch**
1. Add `"service_photo"` to `UploadKind` type and `ALLOWED_KINDS` in `admin-app/src/server/lib/uploadToken.ts`.
2. Add `service_photo` to test coverage in `upload-service.test.js` / `upload-http.test.js`.

### Session 2 — Security Hardening (M)
**Fix in-memory rate limiting and master IDOR**
1. Replace in-memory `Map` in `roleChangeRequests.ts` with D1-backed `checkRateLimit`.
2. Add masterId ownership check in `masterRouter.ts` `getMySchedule`/`getMyAppointments`/`getMyClients`/`getMyEarnings` — verify caller's `masterId` from session matches input `masterId` (skip for `tenant_owner` / `system_admin`).
3. Add URL validation/sanitization for `photo` and `portfolio` fields in `masterRouter.ts`.

### Session 3 — Suspense Boundaries (M)
**Add `<Suspense>` + `loading.tsx` to all dashboard routes**
For each `(dashboard)/*/page.tsx` that renders a `*PageClient`, wrap in `<Suspense fallback={<SkeletonLoader />}>`. Add a reusable `DashboardSkeleton` component. Alternatively add `loading.tsx` files to each segment.
Priority: `/tenants`, `/users`, `/appointments`, `/billing`, `/marketing/*`, `/conversations`.

### Session 4 — Extract Shared Appointment UI (L)
**De-duplicate appointment display logic**
1. Create `components/shared/AppointmentCard.tsx` exporting `AptRow`, `STATUS_LABELS`, `APT_BORDER`, `STATUS_STYLES`, `NO_SHOW_LABELS`, `CANCELLED_BY_LABELS`.
2. Create `components/shared/utils.ts` exporting `relativeTime`.
3. Create `components/shared/ServiceForm.tsx` combining `ServiceModal` (SalonDashboard) and inline service form (MasterDashboard) into one reusable component.
4. Replace all duplicate definitions in `MasterDashboard.tsx`, `TodayTab.tsx`, `SalonDashboard.tsx`, `SupportDashboard.tsx`, `HelpSection.tsx`.

### Session 5 — SalonDashboard Decomposition (XL)
**Split 1,810-line monolith**
Extract each of the 13 tabs into separate files under `components/salon/tabs/` (many already exist: `AppointmentsTab.tsx`, `ServicesTab.tsx`, etc. — use these as the pattern). Migrate inline tab content to the tab files. Reduce `SalonDashboard.tsx` to a tab router + data hydration layer (~200 lines).

### Session 6 — Marketing Module (L)
**Complete or clearly gate Phase 1 stubs**
1. Evaluate whether Campaigns, Templates, SMS, Automations should be hidden entirely until Phase 2 (remove from nav or show coming-soon gate instead of stub pages).
2. If keeping visible: add create/edit flows for Templates and Campaigns.
3. Fix `(api as any).marketing.*` casts — these should use the typed `api.marketing.*` pattern.

### Session 7 — Accessibility Pass (M)
1. Add `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls` to all tab navigation in dashboards.
2. Add focus trapping to modals (`ServiceModal`, `MasterModal`, etc.).
3. Add `aria-labelledby` to all dialogs.
4. Add `aria-label` to icon-only buttons (`CopyBtn`, no-show button, emoji picker button).

### Session 8 — Pagination for Admin Tables (M)
1. Add pagination to `tenants.getAll` (limit/offset with total count).
2. Add pagination controls to `TenantsPageClient`.
3. Add load-more to `LeadsPageClient` (already supports `offset` in API).
4. Add infinite scroll or pagination to `ConversationsClient` (cursor already present in API response).

### Session 9 — Test Coverage (L)
1. Add `__tests__/marketing.test.ts` covering all marketing router procedures.
2. Add `__tests__/tenantStaff.test.ts` covering manager invitation, permission elevation.
3. Add `__tests__/masterDashboard.test.tsx` and `__tests__/salonDashboard.test.tsx` (key tab renders + mutation flows).
4. Fix `isTest` not being propagated through `RoleContext.Provider` in `layout.tsx`.

### Session 10 — Documentation Update (S)
1. Update `admin-app/README.md` to reflect NextAuth session-based auth (remove Telegram initData references).
2. Update `CLAUDE.md` Auth Flow section.
3. Remove or archive `archive/miniapp/` content.
