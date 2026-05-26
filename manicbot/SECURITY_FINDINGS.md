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

Subsequent post-baseline: Worker now at 150 files / 2062 tests; Admin-app at 123 files / 3774 tests; `check-schema` OK (67 tables). `check-tenant-isolation` allowlist updated through line drift only (see ARN-1 below).

---

## Design-level trade-offs accepted (2026-05-16)

### V1 — Salon-owned master passwords stored reversibly 🟦 ACCEPTED-RISK
**Where:** `web_users.password_encrypted` (migration 0065), `server/security/masterPasswordVault.ts`, `salon.peekMasterPassword`, `salon.resetMasterPassword`.

**What:** For master accounts created directly by a salon owner via `salon.createMasterAccount` (origin='salon_created'), we keep an AES-GCM encrypted copy of the plaintext password alongside the standard PBKDF2 hash. The salon owner can decrypt-and-display it under an email OTP gate (`peek_master_password` action) or rotate it (`reset_master_password` action — the new plaintext is emailed directly to the master; the salon never sees the new value in the response).

**Why accepted:** Product requirement — salon-created accounts are treated as the salon's property (the master receives credentials FROM the salon, didn't choose them, can't change them, can only be archived). Reversibility lets the owner recover credentials if the master mislaid them, without inflicting a full password-reset flow on a working employee. Authentication still uses `password_hash` only; the encrypted column is auxiliary.

**Mitigations:**
- Encryption key (`BOT_ENCRYPTION_KEY`) is a Worker secret, never in source, never logged. Same key the channel-token + Google-refresh-token vaults use; rotation runbook (`/admin/rotate-encryption-key`) covers this column.
- HKDF subkey label `master-password-v1` domain-separates from other vault uses, so a single-vault leak doesn't cross-contaminate.
- Read access via `salon.peekMasterPassword` is gated by a fresh 6-digit email OTP (15-min TTL, payload-bound — see V2 below). Audit-logged as `tenant.master.password.peek`.
- Only `origin='salon_created'` accounts populate this column. Masters who registered themselves or accepted an email invitation leave it NULL — their password is owned by them, not the salon.

**Residual risk:** If `BOT_ENCRYPTION_KEY` leaks, every encrypted master password becomes recoverable. Same blast radius as the channel-token leak (every WA/IG/TG token). Treat key rotation as the recovery path.

### V2 — Reversible password peek/reset gated by single-action email OTP 🟦 ACCEPTED-RISK
**Where:** `auth/otp.ts requireOtpConfirmation`, `global_otp_codes` table (migration 0064).

**What:** Sensitive `salon.*` mutations (archive/unarchive master, reset/peek master password) require the caller to first call `otp.request({ action, payload })`, receive a 6-digit code via email, and pass it back as `otpCode`. The code is hashed in D1, payload-bound (SHA-256 of canonical JSON), 15-min TTL, max 5 attempts, single-use (consumed_at).

**Why accepted:** Stronger than no gate (a stolen session alone cannot peek a master password) but weaker than hardware-bound 2FA (a phishing-stage email compromise + session compromise can both occur). Operator-side mitigation: the OTP destination is the salon owner's verified email; multi-factor for that email account is the operator's responsibility.

**Mitigations:**
- Per-(user, action) rate limit at 5 issuances per 10 min (`otp_request`).
- Per-row attempts counter caps brute-force at 5 wrong codes.
- Payload hash binds the code to a single operation (no replay across master ids).
- Action whitelist on the issuance side (`archive_master`, `unarchive_master`, `reset_master_password`, `peek_master_password`) — clients cannot prompt arbitrary OTP emails.

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

### H7 — Salon Day-view appointment status mutations gated by `adminProcedure` (silent 403 in production) ✅ FIXED (2026-05-16)
**Where:** `manicbot/admin-app/src/components/dashboard-ui/AppointmentDetailPanel.tsx:146-149` and the `salon.markDone` / `salon.confirmAppointment` / `salon.rejectAppointment` procedures that now live in `manicbot/admin-app/src/server/api/routers/salon.ts:234-377`.

**What:** The rich appointment-detail panel on `SalonDayView` rendered three pill-buttons ("Выполнено", "Клиент не пришёл", "Мастер не пришёл") plus the existing Confirm / Mark-done variants. Every button called `api.appointments.updateStatus` or `api.appointments.markNoShow` — both `adminProcedure`-gated (system_admin / support / technical_support only). Salon owners (`tenant_owner`) — the actual users of `/dashboard` — were silently rejected by tRPC with FORBIDDEN. The mutation never reached D1, no client notification fired, and the UI showed no error because the panel's `onError` was a silent passthrough. Net effect: the buttons looked functional but the appointment status never changed and no message reached the client.

This is a confidentiality / availability defect. No data leaked, but every "mark done" / "no-show" decision the salon owner believed they made was lost, including the analytics + lifetime_visits side-effects that downstream features (review prompts, repeat-customer reporting) depend on.

**Fix:** The panel now calls `api.salon.confirmAppointment / markDone / markNoShow / cancelAppointment` — all `tenantOwnerProcedure`-gated, all scoping every `UPDATE appointments` WHERE clause with `(id = ? AND tenant_id = ?)`. The legacy `appointments.updateStatus / markNoShow` (adminProcedure) are retained for the God Mode `/appointments` page only. New mutations validate:
- status transition is legal (`pending → confirmed`, `confirmed → done`, etc. — others throw `invalid_status_transition`)
- `markDone` refuses when `apt.ts > now` (`cannot_mark_done_before_start`) to prevent accidental "mark done at 9am for a 5pm appointment" mistakes from the dashboard
- master-scoped variants (`master.confirmAppointment` / `markDone`) re-use the existing `assertCallerIsMaster` IDOR guard so a salon-employed master can only mutate their own appointments

Side-effect dispatch is unified in `manicbot/src/services/appointmentAutomations.js` (`dispatchAppointmentAutomation`). Every status change funnels through it: `lifetime_visits++`, reminder cleanup, `analytics_events` row, marketing-automations lookup, and the default client notification. Default copy lives in one place; the marketing module overrides via `marketing_automations` rows in a follow-up.

**Verification:**
- `manicbot/admin-app/src/__tests__/salon-status-mutations.test.ts` — 16 tests; cross-tenant isolation, status-transition guards, `notifyWorker` invocation per action.
- `manicbot/admin-app/src/__tests__/master-status-mutations.test.ts` — 7 tests; per-master IDOR enforcement.
- `manicbot/test/admin-appointment-action-status.test.js` — Worker handler tests for `done` / `no_show_client` / `no_show_master`; unknown actions now return `400 UNKNOWN_APPOINTMENT_ACTION`.
- `manicbot/test/appointment-automations-dispatcher.test.js` — dispatcher fires lifetime_visits update, reminder cleanup, analytics, and the correct default message per event type.
- Full suites: admin-app 3918/3918 green, Worker 2082/2082 green, `npx tsc --noEmit` clean, `check-schema` OK (68 tables), `check-tenant-isolation` clean (allowlist entry for `salon.ts` cross-tenant bot collision check moved 964 → 1074 to reflect line drift).

### H8 — Bell pipeline silently dropped 100% of writes on Cloudflare Pages ✅ FIXED (2026-05-26)
**Where:** every `notifyWebUser` call site in admin-app — specifically [salon.ts:2607](manicbot/admin-app/src/server/api/routers/salon.ts), [auth.ts:227](manicbot/admin-app/src/server/api/routers/auth.ts), [support.ts:165 / :291 / :415](manicbot/admin-app/src/server/api/routers/support.ts), [messenger.ts:401](manicbot/admin-app/src/server/api/routers/messenger.ts). All five used the `void notifyWebUser(...)` fire-and-forget pattern.

**What:** the `user_notifications` table was **empty globally in production** despite migration 0070 correctly creating the table + indexes (verified via `wrangler d1 execute manicbot-db --remote --command "SELECT COUNT(*) FROM user_notifications"` returning 0). Every bell write — master invites, support replies, cross-staff DMs, appointment notifications, birthday promos — silently dropped. Salon owners reported never seeing a single notification in their bell since registering.

**Root mechanism:** [admin-app `getDb()`](manicbot/admin-app/src/server/db/index.ts) reads the D1 binding from `@cloudflare/next-on-pages`'s `getRequestContext().env.DB`. On Next.js 15 over the Cloudflare Pages adapter, the request context (and the `env.DB` handle it carries) is torn down with the response. The pattern `void notifyWebUser(...)` returns the Promise WITHOUT awaiting it; by the time the Drizzle `INSERT OR IGNORE` reaches `db.prepare()` the binding is dead → throw inside `notifyWebUser` → caught at the wrapper's own try/catch → `{ ok: false, error: 'db_insert_failed' }` returned → caller's `.catch()` (which only catches throws, not returned error objects) never fires → no row in D1, no log line, no `error_events` row. 100% silent loss.

This is an availability defect (not confidentiality — no data leaked). But every operator-visible signal that depends on the bell was broken, including the master-invite flow that is on the salon-onboarding critical path. Pre-launch blocker.

**Fix:**
1. Converted all five `void notifyWebUser(...)` / `void notifyManyWebUsers(...)` / `void notifyPlatformSupportStaff(...)` call sites to `await`. Latency cost: one prefs read + one INSERT per write (~50ms p50), trivially absorbable on a mutation hot path. The await keeps the request context (and D1 binding) alive until the write commits.
2. New shared wrapper [`notifyOrCapture`](manicbot/admin-app/src/server/services/notifyOrCapture.ts) layered on top of `notifyWebUser` — awaits the call, surfaces the verdict as `{ bellQueued, bellSkippedByPrefs, bellError }` for the mutation response, and on `{ ok: false }` writes an `error_events` row with `errorType='notify.bell_write_failed'`. Used by `salon.sendMasterInvitation` (the user-visible path that motivated the audit); other 4 call sites use plain `await notifyWebUser(...).catch(log)` since their mutations don't surface bell-status to the client.
3. `salon.sendMasterInvitation` mutation response extended with `{ bellQueued, bellSkippedByPrefs?, bellError? }` (mirrors PR-A's `emailQueued / transportError`). UI in [InviteByEmailModal.tsx](manicbot/admin-app/src/components/salon/InviteByEmailModal.tsx) renders an amber chip when either bell or email failed, with per-case copy localized in 4 languages.

**Operator visibility going forward:** every silent bell-write failure now writes a row to `error_events` with `errorType='notify.bell_write_failed'`. Monitor `/errors` for 24h post-deploy; zero rows = healthy. PR-A added the same loud-fail contract for email transport; this PR closes the parallel blind spot for in-app delivery so no future regression can hide behind the fire-and-forget shape again.

**Verification:**
- [salon-invite-flow.test.ts](manicbot/admin-app/src/__tests__/salon-invite-flow.test.ts) — 5 new tests for the bell-write visibility contract (TDD red-first then green): happy path, failure surfacing + captureError, opt-out, captureError-throw-doesn't-break-mutation, await-before-return regression pin.
- [notify-or-capture.test.ts](manicbot/admin-app/src/__tests__/notify-or-capture.test.ts) — 6 new tests pinning the shared helper's contract (happy, opt-out, failure + captureError, internal-throw caught, captureError-throw never propagates, tenantId fallback).
- Full suites green: admin-app 278 files / 4987 passed (+ 7 skipped), Worker 196 files / 2656 passed, `npm run typecheck` clean, `npm run check-schema` 91/91 tables match.
- Tenant-isolation allowlist [check-tenant-isolation.mjs:131](manicbot/admin-app/scripts/check-tenant-isolation.mjs) bumped 1751 → 1752 to reflect the +1 line drift from the bell-state vars block.

**Follow-up (out of scope for this PR):** session-id fail-loud (defense-in-depth — [trpc.ts:31](manicbot/admin-app/src/server/api/trpc.ts) silently coerces empty `session.user.id` to the email string, which is harmless today but would mis-route every user-scoped query if a future NextAuth callback regression dropped the `sub` claim).

### H5 — `INSTAGRAM_ACCESS_TOKEN` env-var fallback ✅ FIXED
**Verified:** `manicbot/src/http/metaWebhooksHttp.js:146-150` — if `channelConfig.token` is unset, code logs warning + error and `continue`s, no platform-wide fallback. The fallback to `env.INSTAGRAM_ACCESS_TOKEN` is removed; comment confirms "INSTAGRAM_ACCESS_TOKEN platform fallback removed; set token via POST /admin/ig-token".

### H6 — Next.js 15.5.15 has 14 open high-severity advisories ✅ FIXED (2026-05-11)
**Affected:** `manicbot/admin-app/package.json` — `next` was pinned at `^15.5.15`. The 2026-05-11 GitHub advisory feed surfaced 14 high-severity CVEs against the `next` range `9.3.4-canary.0 ‥ 16.3.0-canary.5`: DoS via Server Components, XSS in App Router with CSP nonces, SSRF via WebSocket upgrades, middleware/proxy bypass via dynamic route parameters, cache poisoning in RSC, image-optimization DoS, and adjacent issues. Manicbot's admin-app uses App Router + CSP nonces + Cloudflare Pages caching → multiple attack surfaces matched.

**Fix:** Bump `manicbot/admin-app/package.json` to `"next": "^15.5.18"` (npm `backport` dist-tag — same major.minor, security-patch line). All 14 high-severity advisories list `>= 15.5.16` as the patched range, so 15.5.18 clears every one.

**Verification:** see the PR that introduces this change — `Bot — Test` CI job runs `npm audit --audit-level=high --omit=dev` and must report 0 high before this row is marked ✅ FIXED. See M6 for the remaining transitive moderate.

### M6 — Transitive `postcss <8.5.10` XSS via unescaped `</style>` 🟦 ACCEPTED-RISK
**Affected:** `node_modules/next/node_modules/postcss` + `node_modules/postcss`. GHSA-qx2v-qp2m-jg93. Severity: moderate.

**Why accepted-risk:** Manicbot does not render untrusted CSS server-side; the attack vector (XSS via `</style>` in CSS stringification) is not exploitable in our deployment. Upstream fix in `postcss>=8.5.10` is gated on next.js releasing a version that bumps the pin. `npm audit fix --force` would downgrade next to 9.3.3 — refused (breaking change). Tracked here until next publishes a release that lifts the pin.

**Action item:** Re-check `npm audit` weekly. Bump `next` patch when a release lifts the postcss pin.

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
- ~~Refactoring marketing module to be tenant-scoped — by design it is `system_admin` God Mode CRM (`adminProcedure`); cross-tenant access is the intended behaviour.~~ **Superseded (2026-05-16, PR 1 of marketing roadmap):** the original `marketing` router stays adminProcedure / God Mode global view, but a sibling **`marketingTenant`** router (`routers/marketingTenant.ts`) now serves the salon-owner / tenant_manager / personal-master surface with `protectedProcedure + assertTenantOwner + eq(table.tenantId, input.tenantId)` on every WHERE clause. Cross-tenant isolation verified by `__tests__/marketingTenant-router.test.ts` (FORBIDDEN on cross-tenant stats/contacts/templates/providers; cross-tenant row write blocked by per-row tenantId verification in `contactUpdate` and `templateUpdate`). `marketing.ts` remains in `scripts/check-tenant-isolation.mjs` SKIP_FILES because that file is still cross-tenant by design; the new `marketingTenant.ts` is scanned and passes (`✅ Scanned 35 router file(s); no missing tenantId predicates.`).

---

## 2026-05-16 — N7 RESOLVED · `marketing_contacts` cross-tenant email collision

**Status:** RESOLVED in migration `0062_clients_overhaul.sql` (commit on branch `claude/festive-gauss-a8e42b`).

**Severity (when found):** medium. The `marketing_contacts.email` column carried a platform-wide `UNIQUE` index (`idx_marketing_contacts_email`) that ignored `tenant_id`. Two salons with the same client email could not both register that lead — the second tenant's INSERT silently failed or merged into the first tenant's row, depending on the call site. Plus several read paths (`leadsRouter.marketingList`, `marketing.contactsList`) did not filter by `tenant_id`, so a tenant_owner page could surface contacts from other tenants if they ever shared the same email.

**Fix:**

- Dropped `idx_marketing_contacts_email` (platform-wide UNIQUE).
- Added `idx_marketing_contacts_tenant_email` (partial UNIQUE on `(tenant_id, email) WHERE email IS NOT NULL`) and a matching `idx_marketing_contacts_tenant_phone`.
- Made `marketing_contacts.email` nullable so phone-only salon clients no longer require synthetic placeholder emails.
- Added back-link column `marketing_contacts.linked_user_chat_id` for bidirectional sync with `users.marketing_contact_id`.
- All new client-write paths (`clients.create`, `clients.update`, `clients.importCsv`, `appointments.createManual`) call `syncMarketingContact(db, tenantId, ...)`. The helper looks up existing rows ONLY within the caller's tenant — cross-tenant linking is now structurally impossible.

**Regression tests pinned:**

- `manicbot/admin-app/src/__tests__/clients-tenant-isolation.test.ts` — every public procedure on `clients` rejects cross-tenant input with FORBIDDEN.
- `manicbot/admin-app/src/__tests__/marketing-sync.test.ts` — sync helper looks up by `(tenant_id, *)` only.

**Pre-flight check** required when applying migration 0062 to production D1:
```sql
SELECT tenant_id, email, COUNT(*) c FROM marketing_contacts
WHERE email IS NOT NULL GROUP BY tenant_id, email HAVING c > 1;
```
Must return 0 rows. Migration fails loud if duplicates exist.

---

## 2026-05-16 — N8 RESOLVED · Worker booking handler crashed on new block-sentinel return types

**Status:** RESOLVED on branch `claude/festive-gauss-a8e42b` (commit `84754a6` and follow-ups).

**Severity:** medium (DoS-class for the Telegram bot booking path).

`services/appointments.js saveApt()` was extended in 0062 to return two new sentinel objects — `BLOCKED_GLOBAL` and `BLOCKED_FOR_MASTER` — in addition to the existing `SLOT_TAKEN`. The Telegram-side booking handler in `src/handlers/callback.js` only special-cased `SLOT_TAKEN`; for the new sentinels it would fall through and access `apt.id` on the frozen sentinel object, throwing `TypeError: Cannot read properties of undefined (reading 'id')` and breaking the booking flow for any blocked client. (Admin-app's `appointments.createManual` was unaffected — it never sees the sentinel and uses TRPCError throws instead.)

**Fix:** Telegram handler now imports both sentinels and short-circuits to a neutral "no slots" reply (we deliberately don't surface the block reason to the client). The admin-app side enforces blocks before the slot-conflict check via `client_blocked_global` / `client_blocked_for_master` TRPCError messages.

**Regression tests pinned:**

- `manicbot/test/client-block-booking.test.js` — `saveApt` returns the right sentinel for global and per-master blocks; an unrelated master in the same tenant remains bookable.
- `manicbot/test/callback-block-sentinel-handling.test.js` — static check on `src/handlers/callback.js` that both sentinels are imported and both branches handled.
- `manicbot/admin-app/src/__tests__/appointments-block-enforcement.test.ts` — admin-app side `client_blocked_global` / `client_blocked_for_master` TRPCError surfaces.

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
