# ManicBot — Security Findings
**Date:** 2026-04-25  
**Reviewer:** Automated sub-agent audit + manual inspection  
**Scope:** Worker, Admin-App, CI/CD pipeline, secrets management

---

## Secrets Status

| File | Secret | Git-committed? | Action |
|------|--------|----------------|--------|
| `.dev.vars` | `ADMIN_KEY=94b8e2...` (64-char hex) | Not committed (verified) | Rotate if value matches production |
| `admin-app/.env` | `AUTH_SECRET="c305ae..."` (64-char hex) | Not committed (verified) | Rotate if value matches production |
| `admin-app/.env` | `TELEGRAM_BOT_TOKEN="test_token"` | Not committed | Not a real token — safe |
| `admin-app/.env` | `DATABASE_URL="https://mock-db-url-..."` | Not committed | Mock value — safe |

**Verification command** (run if you haven't already):
```bash
git log --all --full-history -- ".dev.vars" "admin-app/.env"
```
No output = never committed = safe.

---

## HIGH Severity

### H1 — Local secrets look like real production values
`.dev.vars` contains a 64-char hex `ADMIN_KEY` and `admin-app/.env` contains a 64-char hex `AUTH_SECRET`. These do not appear to be in git history but if either value is reused in production, it must be rotated — these files were visible to anyone with filesystem access.

**Action:** Verify these are dev-only values. If reused in production, rotate via `wrangler secret put ADMIN_KEY` and Cloudflare Pages env dashboard respectively.

### H2 — ADMIN_KEY accepted as URL query param on `/setup` and `/remove-webhook`
**File:** `src/http/adminPanelHttp.js:18, 66`

These two routes read `url.searchParams.get('key')` directly, bypassing the Bearer-header-preferred `isAdminKeyValid()` in `adminKeyHttp.js`. The key appears in:
- Cloudflare request logs
- Referer headers sent to linked resources
- Browser history and bookmarks

```js
// Current (vulnerable):
const key = url.searchParams.get('key');
if (!isAdminKeyValid(key, env.ADMIN_KEY)) return ...;

// Fix: use Authorization header instead
const authResult = await requireAdmin(request, { ADMIN_KEY: env.ADMIN_KEY });
if (authResult) return authResult;
```

### H3 — `connectBot` flow never stores the Telegram bot token
**File:** `admin-app/src/server/api/routers/salon.ts` — `connectBot` mutation

The admin-app validates the token against Telegram and registers the bot in D1, but the token is never stored in Worker KV (where `getBotToken` reads it). After `connectBot`, the Worker cannot process webhooks for this bot — it returns null token and silently fails.

**Root cause:** The admin-app cannot directly write to the Worker's KV. The correct flow must call the Worker's `POST /admin/provision` endpoint (which handles encrypted KV storage), or the admin-app provision endpoint must be adapted.

**Impact:** Salons onboarded via the mini-app dashboard (vs. direct `wrangler` admin provisioning) will have non-functional bots.

### H4 — Support router uses `publicProcedure` for all mutations
**File:** `admin-app/src/server/api/routers/support.ts`

All procedures including `getOpenTickets`, `replyToTicket`, `claimTicket`, `closeTicket`, `escalateTicket` use `publicProcedure`. Auth is enforced only inside the function body via `assertSupport(ctx)`. If any code path can reach these procedures without a valid session, they are fully accessible.

**Fix:** Change all `publicProcedure` declarations to `protectedProcedure`:
```ts
// Before:
export const supportRouter = createTRPCRouter({
  getOpenTickets: publicProcedure.query(async ({ ctx }) => {
    assertSupport(ctx);
    ...

// After:
export const supportRouter = createTRPCRouter({
  getOpenTickets: protectedProcedure.query(async ({ ctx }) => {
    assertSupport(ctx);
    ...
```

### H5 — `INSTAGRAM_ACCESS_TOKEN` env var exposes all tenants' Instagram
**File:** `src/http/metaWebhooksHttp.js:146-147`

If no encrypted token is found in `channel_configs`, the code falls back to `env.INSTAGRAM_ACCESS_TOKEN`. A single leaked env var exposes Instagram posting ability for all tenants who don't have individually-provisioned tokens.

```js
// Current (vulnerable):
const token = channel.tokenEncrypted
  ? await decryptToken(channel.tokenEncrypted, encKey, 'ig')
  : env.INSTAGRAM_ACCESS_TOKEN;  // platform-wide fallback

// Fix: remove the fallback, fail closed
const token = channel.tokenEncrypted
  ? await decryptToken(channel.tokenEncrypted, encKey, 'ig')
  : null;
if (!token) {
  log.warn('meta.ig.no_token', { tenantId: channel.tenantId });
  return null;
}
```

---

## MEDIUM Severity

### M1 — `?key=` query parameter accepted on all 15+ admin routes
**File:** `src/http/adminKeyHttp.js` — `isAdminKeyValid()`

The `?key=` fallback for backward compatibility leaks the ADMIN_KEY into Cloudflare request logs on every admin API call. The Bearer header preference is correct, but the fallback should be removed.

**Fix:** Remove query-param fallback from `isAdminKeyValid()`. All callers have had months to migrate.

### M2 — `connectBot` token flows through Next.js edge unredacted
The raw Telegram bot token (`input.token`) passes through the Next.js tRPC mutation. If the structured logger in admin-app captures it in an error scenario, it may appear in logs. The Worker's logger has `botToken` in its REDACTED_KEYS set; verify the admin-app logger has the same.

**File:** `admin-app/src/server/utils/logger.ts` — check `REDACTED_KEYS` constant.

### M3 — Rate limiter uses fixed window (vulnerable to burst doubling)
**File:** `src/utils/rateLimit.js`

An attacker can make N requests just before window reset, then N more just after — doubling effective rate. This is the classic fixed-window race condition.

**Impact:** Low for admin auth (5 req/15 min is already strict). Higher impact on public search and chat rate limits.

**Fix:** Upgrade to sliding window or token bucket for public endpoints.

### M4 — `sanitizeHtml` is a regex-based sanitizer
**File:** `admin-app/src/server/security/sanitize.ts`

The sanitizer is documented as "best-effort" and is bypassable with mutation patterns. Marketing template HTML (`marketingHtml` profile) allows `style` attributes which can be vectors for CSS injection.

**Fix:** Upgrade to DOMPurify on the server side, or use a proven library (e.g. `sanitize-html` with strict allowlists).

### M5 — No full Content-Security-Policy on Worker responses
**File:** `src/worker.js` — `addSecurityHeaders()`

Current CSP: `frame-ancestors 'none'` (anti-clickjacking only). No `script-src`, `connect-src`, or `img-src` directives.

**Fix:** Add a restrictive CSP. At minimum:
```
Content-Security-Policy: default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'
```

### M6 — Minimum password length inconsistency
Worker's `/admin/web-user` endpoint accepts 8-character passwords (`src/http/adminKeyHttp.js:499`), while the tRPC `webUsers.create` procedure enforces 12 characters. Users created via the Worker endpoint can log into the admin panel with weaker passwords.

**Fix:** Align both to 12 characters minimum.

### M7 — Stripe metadata `tenantId` not validated against D1
**File:** `src/billing/webhooks.js` — `checkout.session.completed` handler

`session.metadata.tenantId` is used to update billing status without first verifying the tenant exists in D1. Requires Stripe key compromise to exploit, but violates defense-in-depth.

**Fix:** Add `SELECT id FROM tenants WHERE id = ?` check before processing.

---

## LOW Severity

### L1 — Admin-app has no Content-Security-Policy headers
`next.config.js` does not define CSP response headers. XSS payloads (if injected) have no browser-level mitigation on the dashboard.

### L2 — `webUsers.setInitialPassword` does not bump `password_changed_at`
Setting an initial password via Google OAuth flow does not invalidate previous JWTs. Low impact (first-time password set) but breaks the session-invalidation invariant.

### L3 — `.env.example` is incomplete
`admin-app/.env.example` is missing `AUTH_SECRET` and `ADMIN_KEY`. New developers may deploy without them or with weak placeholder values.

### L4 — Rate limit D1 table has no TTL enforcement at DB level
Cleanup runs probabilistically (10% of requests). Under high load, cleanup lags and old entries accumulate.

### L5 — `googlePrefillPreview` is a public tRPC procedure with no rate limit
The endpoint decodes Google prefill tokens without rate limiting. While HMAC-signed, the endpoint acts as a validity oracle for token enumeration.

### L6 — `checkAdmin` uses HTTP Basic auth
The legacy HTML admin panel (`/admin`) uses Basic auth — credentials are base64-encoded in Authorization headers and visible to any TLS-terminating proxy or log system.

---

## Unprotected Routes

| Route | Auth | Issue |
|-------|------|-------|
| `GET /setup?key=` | ADMIN_KEY in query param | Key in logs (H2) |
| `GET /remove-webhook?key=` | ADMIN_KEY in query param | Key in logs (H2) |
| `GET /admin/migrate?key=` | Query param still works | Deprecated param not removed |
| tRPC `support.*` | `publicProcedure` + in-body check | Should be `protectedProcedure` (H4) |

**Intentionally public (acceptable):**
- `POST /api/leads`, `POST /api/email-subscribe` — rate-limited landing capture
- `GET /api/search/*` — CORS-open public salon search
- `GET /salon/*` — public salon profiles

---

## Tenant Isolation Assessment

**Status: STRONG.** All critical paths correctly scope data by `tenant_id`:

- All D1 appointment/user/master/service queries include `eq(table.tenantId, input.tenantId)` or `WHERE tenant_id = ?`
- `assertTenantOwner()` rejects empty tenantId (prevents `null === null` bypass)
- `isWebSessionLocked` prevents web chat sessions from escalating to admin roles
- `masterRouter.assertMaster` correctly validates `ctx.webUser.tenantId === input.tenantId`

**One within-tenant gap:**
In `masterRouter.getMySchedule` and `getMyAppointments`, the `masterId` parameter is not validated against the caller's identity — a `master` user can query any other master's schedule within the same tenant by supplying a different `masterId`. Low impact (within-tenant, not cross-tenant).

---

## Security Controls: What's Working Well

| Control | Implementation |
|---------|---------------|
| Token encryption | AES-GCM + HKDF-SHA256 domain-separated subkeys (v1$ prefix) |
| Constant-time comparison | `timingSafeEqual` used on all secret comparisons (WEBHOOK_SECRET, ADMIN_KEY, Meta token) |
| Startup validation | `validateSecurityConfig()` throws on weak/missing secrets before handling requests |
| Webhook HMAC | Telegram: `X-Telegram-Bot-Api-Secret-Token` checked on every request; Meta: `X-Hub-Signature-256` HMAC-SHA256 |
| Admin rate limiting | D1-backed per-credential fingerprint (not per-IP, prevents admin-app IP sharing) |
| Security headers | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, `Referrer-Policy` on all Worker responses |
| Admin-app CSP | `middleware.ts` adds full `script-src`, `connect-src`, `img-src`, `frame-ancestors 'none'` |
| Password hashing | PBKDF2-SHA256 (100k iterations, 16-byte salt) in admin-app; 600k in Worker |
| Login brute-force | 5 failed logins → 15-min lockout + login alert email on new IP |
| Privilege escalation prevention | `ALLOWED_CREATE_ROLES` explicitly excludes `system_admin`; `ADMIN_CHAT_ID`-based God Mode cannot be granted via API |
| PII redaction | Logger redacts email, phone, token, secret, API key, Telegram initData from all log lines |
| AI input sanitization | `sanitizeUserInput()` strips `[TAG:param]` patterns; `validateActionParams()` rejects malformed AI action params |
| CI security scanning | Gitleaks (full git history) + Semgrep (OWASP Top 10, TypeScript, Next.js) on every push |
