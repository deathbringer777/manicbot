# ManicBot — Security Findings

**Date:** 2026-05-09 (v3.1 — post-remediation)
**Previous version:** v2 (2026-04-25)
**Reviewer:** Automated sub-agent audit + manual code review + 4-phase remediation
**Scope:** Worker, Admin-App, CI/CD pipeline, secrets management

---

## Status legend

- ✅ FIXED — verified at the cited file:line in current HEAD
- 🟡 OPEN — confirmed still vulnerable in current code; needs work
- 🟦 ACCEPTED-RISK — present but mitigated by other controls; accepted by maintainer
- ⛔ MOVED — refactored away or merged into another finding

---

## Test baseline (post-remediation, 2026-05-09)

- Worker (`manicbot/`): **104 test files / 1612 tests passing**, `check-schema` OK (57 tables match)
- Admin-app (`manicbot/admin-app/`): **77 test files / 3111 tests passing** (+5 files, +59 tests vs baseline), `tsc --noEmit` clean, `check-tenant-isolation` clean

---

## Secrets Status

| File | Secret | Git history | Action |
|------|--------|-------------|--------|
| `.dev.vars` | `ADMIN_KEY` (64-char hex) | Verified never committed (`git log --all --full-history` empty) | Owner will rotate 2026-05-10 (manual) |
| `admin-app/.env` | `AUTH_SECRET` (64-char hex) | Verified never committed | Owner will rotate 2026-05-10 (manual) |
| `admin-app/.env` | `TELEGRAM_BOT_TOKEN="test_token"` | Mock value | Safe |
| `admin-app/.env` | `DATABASE_URL` mock | Mock value | Safe |

`.gitignore` coverage verified:
- root `.gitignore:2-4,19` — `.env*`, `.dev.vars*`
- `manicbot/.gitignore:163-166` — same
- `manicbot/admin-app/.gitignore:36-37` — `.env`, `.env*.local`

---

## HIGH Severity

### H1 — Local secrets look like real production values 🟦 ACCEPTED-RISK
`.dev.vars` and `admin-app/.env` contain 64-char hex values. Owner will rotate manually 2026-05-10 (out of scope of this remediation). Documented in new `SECRET_ROTATION.md`.

### H2 — ADMIN_KEY accepted as URL query param ✅ FIXED
**Verified:** `manicbot/src/http/adminPanelHttp.js:16-72` — `/setup` and `/remove-webhook` now use `requireAdmin(request, ctx)` which enforces `Authorization: Bearer <key>` header. Query-param fallback removed.

### H3 — `connectBot` flow does not persist Telegram bot token ✅ FIXED (Phase 2.1b)
**Implementation:** `manicbot/admin-app/src/server/security/tokenEncryption.ts` (new) + `manicbot/admin-app/src/server/api/routers/salon.ts:749-826` (updated).

The new helper `encryptBotTokenForWorker` mirrors the Worker's HKDF-SHA256 + AES-GCM scheme with label `bot-token-v1`, producing ciphertext in the same `v1$…` format the Worker's `getBotToken` expects. `connectBot` now:
- Refuses (`INTERNAL_SERVER_ERROR`) if `BOT_ENCRYPTION_KEY` is unset or shorter than 32 chars (fail-closed; no orphan bot rows in D1)
- Encrypts the token BEFORE setting the webhook (so failure is recoverable)
- Stores the ciphertext in `bots.token_encrypted`

**Operator step still required:** set `BOT_ENCRYPTION_KEY` (same value as Worker) in Cloudflare Pages env vars for admin-app. Documented in `SECRET_ROTATION.md`.

**Tests:** `src/__tests__/token-encryption.test.ts` (7 cases, roundtrip with Worker decryptor) + `src/__tests__/salon-connect-bot.test.ts` (4 cases, including fail-closed when key unset).

### H4 — Support router uses `publicProcedure` ✅ FIXED
**Verified:** `manicbot/admin-app/src/server/api/routers/support.ts:34,42,71` and onwards — every procedure now uses `protectedProcedure`. `assertSupport(ctx)` in-body check retained for role granularity.

### H5 — `INSTAGRAM_ACCESS_TOKEN` env-var fallback ✅ FIXED
**Verified:** `manicbot/src/http/metaWebhooksHttp.js:146-150` — if `channelConfig.token` is unset, code logs warning + error and `continue`s, no platform-wide fallback. The fallback to `env.INSTAGRAM_ACCESS_TOKEN` is removed; comment confirms "INSTAGRAM_ACCESS_TOKEN platform fallback removed; set token via POST /admin/ig-token".

---

## MEDIUM Severity

### M1 — `?key=` query parameter on admin routes ✅ FIXED
**Verified:** `manicbot/src/http/adminKeyHttp.js:21-33` — `isAdminKeyValid()` accepts ONLY `Authorization: Bearer <key>` header. Source comment explicitly states the fallback was removed.

### M2 — `connectBot` token unredacted in admin-app logger ✅ FIXED
**Verified:** `manicbot/admin-app/src/server/utils/logger.ts:13-25` — `REDACTED_KEYS` includes `token, secret, apikey, bottoken, bot_token, webhooksecret, webhook_secret, encryptedtoken, accesstoken, refresh_token, authorization, x-telegram-init-data`. Plus regex-based redaction for `BOT_TOKEN_RE` and `STRIPE_KEY_RE`.

### M3 — Fixed-window rate limiter (TOCTOU at boundary) 🟦 ACCEPTED-RISK
**Marker:** `#S-05 KNOWN MEDIUM` in `manicbot/src/utils/rateLimit.js:22-29`.

The atomic single-statement fix (`ON CONFLICT DO UPDATE SET count = CASE WHEN window_start < ? THEN 1 ELSE count + 1 END`) requires updating the in-memory Vitest mock to parse SQLite CASE expressions, which is out of scope for this remediation. Impact is bounded: at the window boundary an attacker may sustain ~2× the declared limit briefly. For admin auth (5 req / 15 min) and public endpoints this is acceptable. Re-evaluate when migrating to a Durable Object based limiter.

### M4 — Marketing HTML sanitizer is regex-based ✅ FIXED (Phase 3.4)
**Implementation:** `manicbot/admin-app/src/server/security/sanitize.ts` now uses `sanitize-html` (parser-based, htmlparser2 under the hood). The library closes the mutation-XSS class of bugs that loose-regex sanitizers cannot catch (mixed-case `<IfRaMe>`, whitespace-broken event handlers, vendor schemes like `vbscript:`, etc.). All four profiles (`text` / `chat` / `salonBio` / `marketingHtml`) preserved. `style` attribute and `allowedStyles: {}` enforce CSS injection blocking.

**Tests:** existing `security-sanitize.test.ts` extended with 9 mutation-XSS vectors (#M4); 30 cases pass. New dependency: `sanitize-html` + `@types/sanitize-html` (admin-app only; pure JS, edge-compatible).

### M5 — Worker CSP incomplete ✅ FIXED
**Verified:** `manicbot/src/worker.js:103-134` — full CSP deployed: `default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com https://challenges.cloudflare.com; … frame-ancestors 'none'`. Comment refers to `#S-08`.

### M6 — Password length inconsistency ✅ FIXED
**Verified:** Worker `manicbot/src/http/adminKeyHttp.js:658` enforces `password.length < 12 → 400`. Admin-app tRPC also enforces `z.string().min(12)`. Aligned.

### M7 — Stripe metadata `tenantId` not validated ✅ FIXED
**Verified:**
- `manicbot/src/billing/webhooks.js:77` resolves tenantId via `SELECT tenant_id FROM stripe_customers WHERE customer_id = ?` (Stripe's customer is authoritative, not arbitrary metadata)
- `manicbot/src/billing/pluginWebhooks.js:59` — explicit "metadata.tenantId does not match stripe_customers.tenant_id — refusing" guard

### N2 — Stale "8-digit" comment vs 6-digit code ✅ FIXED (Phase 3.5)
**Fix:** `manicbot/admin-app/src/server/email/emailService.ts:27` updated to "6-digit verification code (CSPRNG, 15-min TTL)".

### N1 — Password-reset & email-change tokens in URL ✅ FIXED (Phase 2.2 + 2.3)
**Implementation:**
- New templates: `passwordResetCodeEmailHtml`, `emailChangeCodeEmailHtml` — code-only body, no URL
- New email service functions: `sendPasswordResetCodeEmail`, `sendEmailChangeCodeVerification`
- `requestPasswordReset` / `resetPassword` now accept `{ email, code, newPassword }`; reset-password page rebuilt to take email + 6-digit code + new password
- `requestEmailChange` / `confirmEmailChange` migrated to 6-digit code; `confirmEmailChange` is now `protectedProcedure` (was public), narrowing TOCTOU window
- Email-change UI now two-step inline in `AccountSection` (request → enter code), legacy `/confirm-email-change` page returns "use settings panel" message
- Legacy `sendPasswordResetEmail` / `sendEmailChangeVerification` retained as `@deprecated` for in-flight tokens; new callsites blocked by Semgrep rules `legacy-url-password-reset` / `legacy-url-email-change`

**TOCTOU close-out (Phase 2.3):** `confirmEmailChange` now uses `ctx.webUser.id` for the UPDATE, eliminating the lookup-by-token race. The remaining cross-user race (two users targeting the same email) is caught by the `idx_web_user_email` UNIQUE INDEX (schema.sql:429); a `try/catch` around the UPDATE surfaces CONFLICT.

**Tests:** `password-reset-code.test.ts` (13 cases), `email-change-code.test.ts` (10 cases) — confirm code-in-body, no URL leakage, constant-time compare, TTL logic, TOCTOU narrative.

### N3 — Login-alert email leaks IP to user ✅ FIXED (Phase 3.1)
**Fix:** `loginAlertEmailHtml` no longer renders the IP row. The IP is still recorded server-side in `web_users.last_login_ip` and shown to the user via the authenticated dashboard. Tests in `email-privacy.test.ts` confirm IPv4 and IPv6 are scrubbed across all 4 languages.

### N4 — Role-decision email forwards `adminNote` to user ✅ FIXED (Phase 3.1)
**Fix:** `roleRequestDecisionEmailHtml` now renders only a generic "An admin left a note — view it in your dashboard" hint, not the note text itself. The user reads the actual note via the authenticated `roleChangeRequests.getMyRequest` query in their dashboard. Tests in `email-privacy.test.ts` confirm a high-entropy probe string is never reflected.

### N5 — within-tenant IDOR on `masterRouter` ✅ FIXED (already)
**Verified:** `manicbot/admin-app/src/server/api/routers/masterRouter.ts:42-66, 96, 107, 126, 147, 166, 209, 222` — `assertCallerIsMaster` enforces `boundRow.chatId !== masterId` for `master` role using `masters.web_user_id` binding (migration 0043, backfilled by 0046). Comment markers `#S-01`/`#P0-4` confirm prior fix. Defense-in-depth regression test added in Phase 2.1.

### N6 — `requestPasswordReset` rate limit by IP only ✅ FIXED (Phase 3.2)
**Fix:** `requestPasswordReset` now applies BOTH a per-IP and a per-email rate limit. New constant `RL_RESET_PER_EMAIL_MAX = 3` per 10-min window. The per-email layer blocks attackers who rotate IPs (Tor / proxy farm) from hammering a single mailbox. Identical generic error message for both gates so anti-enumeration is preserved.

### Email-change confirm TOCTOU race ✅ FIXED (Phase 2.3)
**Resolution:** see N1 entry above — the migration to a code-based, session-scoped `confirmEmailChange` eliminates the row-by-token lookup. Cross-user races now collide on the `idx_web_user_email` UNIQUE INDEX and surface as CONFLICT to the caller.

---

## LOW Severity

| ID | Status | File:line | Note |
| --- | --- | --- | --- |
| L1 — admin-app CSP | ✅ FIXED | `manicbot/admin-app/src/middleware.ts:60-97` | Full CSP with nonce-based `script-src` |
| L2 — `setInitialPassword` `password_changed_at` | ✅ FIXED (intentional skip) | `webUsers.ts:858-897, 879-885` | Comment explains: no prior password = no other sessions to invalidate |
| L3 — `.env.example` completeness | ✅ FIXED (Phase 3.5) | `manicbot/admin-app/.env.example` rewritten with `AUTH_SECRET`, `ADMIN_KEY`, `BOT_ENCRYPTION_KEY`, `AUTH_URL` placeholders + structured comments |
| L4 — rate-limit cleanup probabilistic | ✅ FIXED (Phase 3.3) | `manicbot/src/handlers/cron.js` now calls `cleanupExpired(ctx, 86400)` every cron tick; the 10% probabilistic sweep in `rateLimit.js` is now a fast-path bonus, not the only mechanism |
| L5 — `googlePrefillPreview` no rate limit | ✅ FIXED (already, `#S-16`) | `webUsers.ts:80-96` — 30 req/IP per RL_WINDOW |
| L6 — legacy `/admin` Basic auth | 🟦 ACCEPTED-RISK | legacy HTML panel; long-term: deprecate |
| L7 — admin-app PBKDF2 100k vs Worker 600k | 🟦 ACCEPTED-RISK | `manicbot/admin-app/src/server/auth/password.ts:8` — Cloudflare Pages edge runtime caps PBKDF2 at 100k iterations. The Worker uses 600k via Workers runtime. Cannot raise admin-app without leaving the edge runtime; impact mitigated by 5-attempt brute-force lockout + 15-min cooldown |

---

## Verified-fixed defense-in-depth (high confidence)

- **Tenant isolation:** `assertTenantOwner` and `assertCallerIsMaster` cover every tenant-scoped procedure; `web_user_id` binding (migration 0043 + 0046 backfill) is authoritative.
- **Token encryption:** AES-GCM + HKDF-SHA256 with `v1$` prefix, domain-separated by label (`bot-token-v1`, `channel-token-v1`); old-key fallback via `decryptTokenWithFallback`.
- **Constant-time compare:** `timingSafeEqual` and `timingSafeEqualHex` used on every secret comparison (WEBHOOK_SECRET, ADMIN_KEY, Meta App Secret, password reset hash, login token hash, verification token hash).
- **Webhook validation:** Telegram `X-Telegram-Bot-Api-Secret-Token`, Meta `X-Hub-Signature-256` HMAC-SHA256, Stripe webhook signature on every inbound.
- **Startup validation:** `validateSecurityConfig()` in `worker.js` throws on weak/missing secrets before serving requests.
- **One-time login token (`#P1-6`):** Verification email no longer requires sessionStorage password; 5-min single-use token consumed via NextAuth credentials provider.
- **Token storage at rest:** verification, password reset, login, email-change, prefill — all SHA-256 hashed; only ciphertext lives in DB.
- **Anti-enumeration:** `requestPasswordReset` always returns `{ ok: true }` regardless of email match.
- **Privilege-escalation guard:** `ALLOWED_CREATE_ROLES` excludes `system_admin` from `/admin/web-user`.
- **Logger PII redaction:** key-name allowlist + regex (`BOT_TOKEN_RE`, `STRIPE_KEY_RE`, `EMAIL_RE`, `PHONE_RE`).
- **Plugin invariants:** all 12 invariants from `plugins/SECURITY.md` checked against `assertPluginEnabled.ts`. (Currently no plugin runtime routers exist; only manifests — applies on first plugin to ship.)
- **CI:** Gitleaks (full git history) + Semgrep (OWASP Top 10, TypeScript, Next.js) on every push.
- **`#S-08` Worker CSP, `#S-10` per-credential admin rate limit, `#P1-4` channel UNIQUE constraint** — all live.
- **tRPC error formatter:** `manicbot/admin-app/src/server/api/trpc.ts:55-95` redacts INTERNAL_SERVER_ERROR, strips stack/cause, allows only ZodError + intentional TRPCError messages.

---

## Items deliberately out of remediation scope

- Re-keying `BOT_ENCRYPTION_KEY` — has its own runbook (`scripts/rotate-bot-encryption-key.js`).
- Penetration-testing the live deployment — source-level audit only.
- Refactoring marketing module to be tenant-scoped — by design it is `system_admin` God Mode CRM (`adminProcedure`); cross-tenant access is the intended behaviour.

---

## Diff vs v2 (2026-04-25) — final after Phase 1–4 remediation

- **Closed (verified-fixed):** H2, H3, H4, H5, M1, M2, M4, M5, M6, M7, L1, L2 (intentional), L3, L4, L5, N1, N2, N3, N4, N5, N6, email-change TOCTOU
- **Newly identified during audit:** N1, N2, N3, N4, N6 — all closed in this remediation
- **Accepted-risk (documented, not fixed):** H1 (dev-secret rotation runbook delivered, owner rotates manually 2026-05-10), M3 (sliding-window upgrade requires Vitest mock work; impact bounded by current limits), L6 (legacy /admin Basic auth, deprecation tracked separately), L7 (admin-app PBKDF2 capped by edge runtime; mitigated by 5-attempt lockout)
- **Plugin `assertPluginEnabled` coverage:** N/A — no plugin runtime routers exist in `manicbot/plugins/*/router.ts` yet (only manifests). Will apply on first plugin to ship.

## CI guards added (Phase 4)

- `.semgrep/manicbot-rules.yml` — custom Semgrep rules block: state-changing `publicProcedure` mutations on tRPC routers (#H4 regression guard); ADMIN_KEY in URL query params (#S-04 regression guard); legacy URL-token email senders (#N1 regression guard)
- `manicbot/admin-app/scripts/check-tenant-isolation.mjs` — heuristic scanner for Drizzle queries against tenant-scoped tables that omit `tenantId` predicate; wired into CI as `npm run check-tenant-isolation`
- Both run on every push/PR via `.github/workflows/deploy.yml`

## Documentation delivered

- `manicbot/SECRET_ROTATION.md` — runbook for ADMIN_KEY and AUTH_SECRET rotation, with verification checklist and a per-secret inventory table
- `manicbot/admin-app/.env.example` — rewritten with full secret list and structured comments
- This file (`SECURITY_FINDINGS.md`) updated to v3.1 with verified status per item
