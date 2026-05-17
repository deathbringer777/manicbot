# ManicBot — Architecture Reference

## Working with the user (read first)

- **Read the user's initial message in full before doing anything.** Don't skim, don't compress, don't drop details. If the request has multiple parts, address every part — not just the first or the most obvious.
- **Do not optimize for brevity at the cost of fidelity.** If the prompt asks for X, Y, and Z, deliver X, Y, and Z. Saving output tokens by skipping pieces of the request is a failure mode, not a feature.
- **Restate the ask only when ambiguous.** Otherwise just do the work — the user runs in autonomy mode (no confirmation pauses for commit/push/deploy/migrate).
- **If you skip something on purpose** (out of scope, blocked, won't fix), say so explicitly. Silent omission = bug.
- **Re-read context before assuming.** When a long CLAUDE.md / system reminder / file is in scope, scan for the relevant section instead of answering from a guess at the middle.

## Overview

Multi-tenant Telegram bot platform for nail salon booking. Two deployable units:


| Unit               | Path                  | Runtime                         | Deploy                    |
| ------------------ | --------------------- | ------------------------------- | ------------------------- |
| **Worker**         | `manicbot/`           | Cloudflare Workers              | `npx wrangler deploy`     |
| **Admin Mini-App** | `manicbot/admin-app/` | Cloudflare Pages (Next.js edge) | git push → GitHub Actions |


---

## Roles


| Role                | Scope    | Description                                            | Mini-app           |
| ------------------- | -------- | ------------------------------------------------------ | ------------------ |
| `system_admin`      | Platform | Creator (ADMIN_CHAT_ID). Root access to everything.    | God Mode dashboard |
| `technical_support` | Platform | Platform tech support. Superset of `support`.          | Support dashboard  |
| `support`           | Platform | Customer support agents.                               | Support dashboard  |
| `tenant_owner`      | Tenant   | Salon owner. Manages their salon, staff, billing.      | Salon dashboard    |
| `master`            | Tenant   | Nail technician. Sees own schedule, clients, earnings. | Master dashboard   |
| `client`            | —        | Default for all users. No mini-app access.             | —                  |


**Important:** `ADMIN_CHAT_ID` (Cloudflare secret) is always God Mode regardless of DB state.
**No "admin_salon" concept** — salon admin = `tenant_owner`.

### Independent (Personal) Masters

Masters can work independently without belonging to a salon. When a master registers via the web (`role = "master"`), the system auto-creates a **personal tenant** (`tenants.is_personal = 1`) and a master record with a synthetic `chatId` (range 10B+, avoids Telegram ID collision).

- **Auth**: `auth.getMyRole` returns `{ role: "master", tenantId, masterId, isPersonalTenant: true }`
- **Access**: `assertTenantOwner()` grants owner-level access to masters on their personal tenant — they can manage services, settings, etc.
- **Dashboard**: `MasterDashboard` receives `isPersonal` prop and shows extra tabs (Services, vacation toggle)
- **Service CRUD**: `masterRouter.createService / updateService / deleteService` — guarded by `assertPersonalMaster()` (requires personal tenant)
- **Fallback**: Legacy masters without a tenant see `MasterSetup` onboarding (creates personal tenant on demand via `webUsers.createMyTenant`)

---

## Storage


| Store  | What                                                                  | Key pattern      |
| ------ | --------------------------------------------------------------------- | ---------------- |
| **D1** | Tenants, bots, users, appointments, roles, services, billing, tickets | SQL tables       |
| **KV** | User state, locks, encrypted bot tokens, chat history (TTL 1h)        | Various prefixes |


KV key patterns:

- `t:{tenantId}:`* — tenant-scoped data
- `b:{botId}:`* — legacy single-bot data
- `state:{cid}` — user conversation state
- `master:{cid}` — master data (KV legacy mode)
- `cfg:admin` — admin chat ID (legacy KV mode)

### Legacy single-bot vs D1 multi-tenant

- **D1 path:** Telegram calls `POST /webhook/{botId}`; `resolveTenantFromBotId` loads tenant + encrypted token from D1. KV prefix `t:{tenantId}:`*.
- **Legacy path:** Single `BOT_TOKEN` + `WEBHOOK_SECRET` in env; `POST /webhook` (no botId in path); `buildLegacyCtx` uses KV prefix `b:{botId}:`*. **Opt-in only**: requires Worker var `ALLOW_LEGACY_BOT_CTX=1` (P2-3). With the var unset (the prod default) the legacy fall-through returns `null`/404 and a `[SECURITY]` warning fires on startup whenever the flag is set.
- **Stricter production:** set Worker var `REQUIRE_WEBHOOK_BOT_ID=1` when D1 is bound to reject legacy `POST /webhook` (403 — use `/webhook/{botId}` only). Cron and HTML admin routes are unchanged. Both `REQUIRE_WEBHOOK_BOT_ID=1` and `ALLOW_LEGACY_BOT_CTX` unset is the recommended prod posture.

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
- `0023_personal_tenants.sql` — `is_personal` on `tenants` (independent masters)
- `0024_role_change_requests.sql` — role change request system
- `0025_nullable_password_hash.sql` — `password_hash` nullable for Google OAuth registration
- `0031_marketing_contacts.sql` — deduped lead directory (email/phone) for marketing module
- `0032_marketing_schema.sql` — full marketing module (segments, templates, campaigns, sends, automations, providers, consent log) + CRM columns on `marketing_contacts` (tags, consent, lifecycle, tenant scope)
- `0033_is_test_flag.sql` — `is_test` column on `tenants` (synthetic accounts created by `npm run seed:test-accounts`; surfaced in `auth.getMyRole.isTest`, `publicSalon.search`, `tenants.getAll({ test })`, and a yellow `TEST` badge in the admin/public UI). Roster lives in [TEST_ACCOUNTS.md](TEST_ACCOUNTS.md).
- `0034_tenant_manager.sql` — `tenant_member_permissions`, `tenant_action_requests`, `permission_elevation_codes` for the `tenant_manager` role.
- `0035_plugins.sql` — `plugin_installations` (install rows, platform- or tenant-scoped) and `plugin_events` (immutable audit trail). Powers the Plugin Marketplace — see [Plugin Marketplace](#plugin-marketplace) below.
- `0049_master_calendar_visibility.sql` — `calendar_visibility` column on `masters` (`'private' | 'salon_only' | 'salon_and_peers'`, default `salon_only`). Master-owned setting that governs peer-to-peer calendar sharing within a tenant. Salon owner visibility is unaffected (always sees, enforced by tRPC guards). Toggle UI lives in `MasterDashboard` profile tab; tRPC mutation `master.updateCalendarVisibility` rejects writes from `tenant_owner` (master owns the toggle by design); `system_admin` may override for support escalation. Note: 0036–0048 are existing migrations; 0040/0041 gap is intentional.
- `0050_cookie_consent_log.sql` — `cookie_consent_log` (APPEND-ONLY GDPR/ePrivacy audit trail of cookie banner decisions). Distinct from `marketing_consent_log` (email/SMS opt-ins keyed by `contact_id`). Powers the consent gating that protects the `/api/track` ingest and any future third-party pixels.
- `0051_composite_indexes.sql` — composite indexes to close cron + analytics query gaps (relax.md §7 P1-6): `idx_apt_unsynced` (partial; covers Google Calendar sync cron scan), `idx_apt_master_date` (MasterDashboard schedule filter), `idx_apt_created` (recent-activity ORDER BY), `idx_conv_user` (unified-inbox "user history" lookup), `idx_msend_campaign_status` (marketing campaign progress page).
- `0052_masters_is_synthetic.sql` — `is_synthetic` flag on `masters` so we stop relying on the brittle `chat_id >= 10B` heuristic to identify web-only personal masters. Backfilled for existing rows where `chat_id >= 10000000000`. Set to `1` on the four creation paths in admin-app: `webUsers.register`, `webUsers.createMyTenant`, `provisioning.provisionTestAccount`, `roleChangeRequests` (owner→master), and `salon.inviteMaster`. Cron `processPostVisitConfirmations` LEFT JOINs `masters` and skips rows where `is_synthetic = 1` (relax.md §7 P1-7).
- `0054_tenant_fts_triggers.sql` — INSERT/UPDATE/DELETE triggers on `tenants` that keep `tenant_fts` (FTS5 virtual table, originally created in `0004_fts_search.sql`) in sync with `tenants.search_text`. Previously the FTS index was only seeded ad-hoc by `/admin/seed` and `/admin/provision`; every regular write left the index stale, so the public directory router was forced to fall back to `LIKE '%q%'` (full-table scan). With the triggers in place, `publicSalon.search` and `publicSalon.autocomplete` JOIN against `tenant_fts MATCH ?` for O(log N) keystroke lookups. The migration also backfills the FTS table from `tenants`, so the rollout is zero-downtime.
- `0055_analytics_promo_dedup.sql` — partial UNIQUE index on `analytics_events(tenant_id, user_id, event, date(created_at, 'unixepoch'))` where `event = 'promo.returning_candidate'`. Closes P1-1: the `processBirthdayAndReturningPromos` cron used to dump a duplicate row every 15 min for 30 days per eligible client; with `INSERT OR IGNORE` + this index, dupes are silent.
- `0056_error_events.sql` — `error_events` table for the in-house God Mode error monitor. Worker `captureError()` (`src/utils/errorCapture.js`) writes here with 1h dedup on `fingerprint` (FNV-1a of error_name + message + path); admin-app `/errors` page reads/resolves rows via the `errorEvents` tRPC router. `source` is bucketed to the enum `worker | admin-app | cron | edge | unknown`; the raw caller location is preserved in `context.source_raw`. Indexed for the dashboard filters: `(severity, last_seen)`, `(fingerprint)`, `(tenant_id, last_seen)`, `(resolved_at, last_seen)`.
- `0057_error_events_extend.sql` — extends `error_events` with **status lifecycle** (`open | resolved | ignored | snoozed`, default `open`), `snooze_until`, `assignee_id`, `resolved_by`, `tags_json`, `environment` (default `production`), `release`, `error_type`, `url`, `method`, `request_id`, `sample_json`, `users_affected`, `title`. The 0056 1h-dedup window is replaced by status-aware dedup: one row per (fingerprint, tenant_id); a new fire on a `resolved` issue flips status back to `open` (**regression** signal — surfaced as the `regressed` flag on `errorEvents.list` rows and a 24h counter in `errorEvents.stats`). `ignored` issues bump count silently; `snoozed` reopen automatically once `snooze_until` passes. tRPC additions: `setStatus`, `snooze`, `assign`, `setTags`; `stats` returns `byStatus` + `regressions24h`; `resolve` now sets `resolved_by` from `ctx.webUser.id`. Indexes: `(status, last_seen)`, `(assignee_id, status, last_seen)`. Backfill: rows with `resolved_at IS NOT NULL` get `status='resolved'`; `title` filled from `substr(message,1,200)`.
- `0062_clients_overhaul.sql` — Salon Clients tab overhaul. Extends `users` with multi-channel contact (`email`, `ig_username`, `notes`, `tags`), CRM fields (`marketing_contact_id`, `is_blocked_global` + `_reason` + `_at`, `lifetime_visits`, `last_visit_at`), and soft-delete (`updated_at`, `deleted_at`). Adds `users_fts` FTS5 virtual table + INSERT/UPDATE/DELETE triggers mirroring the 0054 `tenant_fts` pattern (keystroke search across name/phone/tg/email/ig/tags). New `master_client_blocks` table powers per-master blacklists (enforced in Worker `services/appointments.js` `saveApt` via the new `BLOCKED_GLOBAL`/`BLOCKED_FOR_MASTER` sentinels — Telegram callback handler in `src/handlers/callback.js` short-circuits both sentinels to a neutral "no slots" reply so the block reason is not leaked to the client). Rebuilds `marketing_contacts` so `email` is **nullable** and the previously platform-wide UNIQUE on `email` is replaced by per-tenant `(tenant_id, email)` + `(tenant_id, phone)` partial UNIQUE indexes — fixes the cross-tenant email collision bug (SECURITY_FINDINGS N7) that forced synthetic email workarounds. Adds `linked_user_chat_id` on `marketing_contacts` for the bidirectional link between salon clients and the marketing directory. New tRPC `clients` router (list/get/create/update/delete/setGlobalBlock/exportCsv/importCsv/csvTemplate/tagSuggestions) is the primary surface; new master-side procedures `master.blockClient` / `unblockClient` / `listMyBlockedClients`. Sync helper at `~/server/clients/marketingSync.ts` is invoked from `appointments.createManual` + the clients router; CSV import/export uses `~/server/clients/csv.ts`. UI lives in `components/salon/tabs/ClientsTab.tsx` (replaces the read-only legacy tab) + `components/salon/tabs/clients/{ClientFormModal, ClientDetailModal, ImportClientsModal, ClientRow}`. The salon-dashboard floating FAB switches to single-action "+ Add client" on the Clients tab (`QuickAddFab mode="client"`). `ManualBookingModal` now accepts phone/email/Telegram/Instagram as alternative contacts when creating a new client (server-side fail-fast block check runs before slot-conflict for existing-client bookings). `MasterDashboard` Clients tab gains per-row Block / Unblock buttons backed by `master_client_blocks`. Modals dropped the `glass-card` translucent utility in favour of solid `bg-white` / `dark:bg-slate-900` with `z-[100]` overlays (`bg-slate-950/70 backdrop-blur-md`) to sit definitively above Shell's sticky header (z-30/40) and bottom nav (z-50). The same contract was extended to the FAB scenario dialogs (`TimeOffDialog`, `TimeReservationDialog`) and the global `EmailVerificationPopup` so every full-screen modal in the dashboard follows one stacking rule; the regression test (`modal-styling-regression.test.ts`) pins all seven files. Test coverage: `clients-router.test.ts`, `clients-tenant-isolation.test.ts`, `marketing-sync.test.ts`, `csv-clients.test.ts`, `master-blocks.test.ts`, `appointments-block-enforcement.test.ts`, `modal-styling-regression.test.ts`, `ClientFormModal.test.tsx`, `ClientRow.test.tsx`, `ClientsTab.test.tsx`, `QuickAddFab.test.tsx`, `client-block-booking.test.js` (Worker), `callback-block-sentinel-handling.test.js` (Worker static-check). Pre-flight check before applying (caller's responsibility): no `(tenant_id, email)` duplicates exist in `marketing_contacts` — otherwise the migration fails loud.
- `0063_master_origin_and_archive.sql` — `masters.origin` (`salon_created | invited_email | invited_telegram | self_registered`, default `salon_created`) + `masters.archived_at` nullable soft-delete. Backfilled from `is_synthetic` + `chat_id` range so existing rows preserve current semantics. Drives the salon vs master ownership of profile fields (PR 2: delegation toggles for `invited_*`). Indexes: partial `idx_masters_active ON masters(tenant_id) WHERE archived_at IS NULL`, `idx_masters_tenant_origin`.
- `0064_master_invitations.sql` — `master_invitations` table for the email-invite flow. One row per pending invite; partial UNIQUE on `(tenant_id, email) WHERE status='pending'` prevents duplicates. Scenario stamped at send time (`existing_user` → in-app accept link / `new_user` → magic-link register). Hashed CSPRNG token (raw token only in the email, never in D1). 7-day TTL. Routes: `/invitations/[id]` (Scenario A accept) and `/register/invite/[token]` (Scenario B register).
- `0065_global_otp_codes.sql` — generic OTP store for destructive/role-escalation mutations. Row keyed by `(web_user_id, action, payload_hash)`; the payload hash binds the code to a single operation so a code for `archive_master, masterId=A` cannot be replayed for `masterId=B`. 15-min TTL, max 5 attempts. Consumed by `auth/otp.ts requireOtpConfirmation`; issued by the `otp.request` tRPC procedure (whitelisted actions only). Current callers: `salon.archiveMaster`, `salon.unarchiveMaster`, `salon.resetMasterPassword`, `salon.peekMasterPassword`.
- `0066_master_password_vault.sql` — `web_users.password_encrypted` (nullable). AES-GCM ciphertext via the same primitive as `channel_configs.token_encrypted` (`BOT_ENCRYPTION_KEY` + HKDF label `master-password-v1`). ONLY populated for salon-owned master accounts (origin='salon_created'); read via `salon.peekMasterPassword` under OTP gate. Self-registered + invited masters leave it NULL (they own their own credentials). **Security trade-off**: reversible storage is weaker than PBKDF2-only; the encrypted plaintext is auxiliary (auth still uses `password_hash`), the encryption key is a Worker secret, and reads are OTP-gated + audit-logged. See `SECURITY_FINDINGS.md` for the formal entry.
- `0067_messenger.sql` — schema-only foundation for the internal messenger (PR 3+): `threads` (kind ∈ `staff_dm | staff_group | client_conv | system`, partial UNIQUE on (tenant, dm_key) WHERE staff_dm, partial UNIQUE on (tenant, client_conversation_id) so each existing `conversations` row mirrors into exactly one thread), `thread_members` (web_user | external_client, with `last_read_message_id` for per-user read state), `thread_messages` (ULID PK → lexicographic = chronological ordering; tenant_id denormalized for isolation defense). No runtime callers yet — the router + bot-service auto-create on inbound + the `/messages` UI ship as separate PRs.
- `0070_reminders_and_notifications.sql` — three new tables that power the **Reminders plugin** + the **platform-wide in-app notification bell**:
  - `plugin_reminders` — per-tenant reminder/routine definitions. Recurrence is stored as JSON validated by zod at the tRPC boundary (`~/lib/recurrence.ts` shared with the Worker via JS mirror at `src/lib/recurrence.js`); supported DSL is `once | daily | weekly | monthly_day`. `kind ∈ {reminder, routine}` is a UI-only label, both go through the same fire path. `target_master_id` null = owner/unassigned column. `channels_json` is a subset of `["inapp", "telegram"]`. Soft-delete via `archived_at`.
  - `plugin_reminder_fires` — append-only fire log + idempotency claim. The UNIQUE `(reminder_id, fires_at_epoch)` index IS the contract: `INSERT OR IGNORE` in the cron loop returns `changes=0` if a previous tick already fired the same occurrence. `delivery_state ∈ {pending, sent, failed}`.
  - `user_notifications` — generic platform-wide in-app feed consumed by `NotificationBell` in `Shell.tsx` (header). The reminders plugin is the first writer (`kind='reminder.fired'`); future features (checklists, billing alerts) write into the same table — no router changes needed. Partial UNIQUE `(web_user_id, source_slug, source_id, kind)` dedups bell entries on cron retry.

  Powers the new **Worker plugin-cron runtime**: `src/handlers/cron.js` exposes a static `PLUGIN_CRON_DISPATCHERS` map (currently `{ reminders: remindersCron }`) consumed by the new `phasePluginCron` orchestrator phase. The orchestrator loops `plugin_installations` for the current tenant where `enabled=1`, skips paid-addon installs in `past_due`/`canceled`, and dispatches to the slug's handler inside a try/catch so a misbehaving plugin cannot break siblings or the rest of the orchestrator. Adding a future cron plugin = one new import + one entry in `PLUGIN_CRON_DISPATCHERS` (plus the plugin's own `cron.js` handler).

  New helper: `src/services/userNotify.js` — multi-channel notification fanout. Always writes in-app (unless `opts.inapp=false`). Optional Telegram dup gated on the target having a non-synthetic master row (`masters.web_user_id`-linked, `is_synthetic=0`, `chat_id` outside the 10B+ synthetic range). Idempotent on the in-app side via the partial UNIQUE described above when `sourceSlug` + `sourceId` are passed.
- `0071_ownership_transfer_tokens.sql` — single-use, 24h-TTL tokens for self-serve tenant-ownership handoff. Owner initiates → row created + email to current owner's inbox with the raw token → confirmation flips `tenant_roles` and `web_users.role` in a single transaction (target → `tenant_owner`, old owner → `master` with synthetic `chat_id`). Partial UNIQUE index `idx_ott_one_pending ON ownership_transfer_tokens(tenant_id) WHERE consumed_at IS NULL AND cancelled_at IS NULL` enforces "at most one in-flight request per tenant" at the DB level — the in-process check in `requestTransfer` gives a friendlier error than a unique-violation, but the index is the durable invariant. Powers tRPC `ownership` router (`requestTransfer` / `confirmTransfer` / `cancelTransfer` / `getPending`) + the public `/ownership/confirm?token=…` route. Eligibility (`checkTransferEligibility`) is re-checked at confirm-time so a downgrade since the request can't bypass the gate. `confirmTransfer` is IP-rate-limited (20/10min) as defense-in-depth even though tokens carry ~190 bits of entropy. Backend tests: `ownership-logic.test.ts` (22 cases: happy path + 5 rejection paths + token-gen entropy + hash determinism + expiry edge), `ui-prefs-tenant-isolation.test.ts` (7 cases asserting `assertTenantMember` rejects cross-tenant probes via the new UI-prefs endpoint), `settings-shell-sections.test.tsx` (locks the 8-section contract for `tenant_owner` / `tenant_manager` and the top-tab layout).

---

## Channel Health & Recovery (2026-05-14 incident)

Background: `@manicbot_com` IG went silent from **2026-03-30 to 2026-05-14**. Diagnosis chain (compound failure, in causal order):

1. **Cron consumer dropped IG-only tenants.** `worker.js queue()` early-exited at `botIds.length === 0` and ACKed without running `handleCron`. The IG-only `t_1c305v2g5011` got zero cron ticks → no token refresh, no health probe, no resubscribe heartbeat.
2. **`BOT_ENCRYPTION_KEY` rotated** without re-encrypting `channel_configs.token_encrypted`. `getChannelConfig` returned `token=null` and emitted `channel.token.decrypt_failed`; the IG handler bailed at `!channelConfig.token` and silently dropped every webhook.
3. **Page subscription drifted.** With no live token, no resubscribe fired and Meta eventually de-prioritized delivery.
4. **No health probe existed**, so the entire chain was invisible to monitoring. Detected only because the operator opened IG and noticed.

### Mitigations shipped

- **Cron now serves IG-/WA-only tenants.** `worker.js queue` looks up `tenantHasActiveChannel()` and falls back to `buildBotlessTenantCtx()` for tenants with an active `channel_configs` row but no Telegram bot. `handleCron` tolerates `ctx.bot = null` — channel-only phases run; Telegram-only paths no-op.
- **Old-key fallback with auto re-encrypt.** `getChannelConfig` accepts an optional `oldKey` arg (or reads `ctx.BOT_ENCRYPTION_KEY_OLD`). On a successful old-key decrypt it **re-encrypts the row in place with the current key**, so the next rotation doesn't compound.
- **Daily `subscribed_apps` resubscribe.** [src/handlers/cron.js](manicbot/src/handlers/cron.js) `maybeResubscribeIgWebhook` — Phase 0 always-run, idempotent via `cron:phase:ig_resubscribe:last` (24h window). POSTs `messages, messaging_postbacks, message_reads` to `/{page_id}/subscribed_apps`. Keeps the Meta-side subscription warm.
- **`phaseChannelHealth` (6h window).** Probes Graph `/me` with the decrypted Page token and reads `/{page_id}/subscribed_apps`. On token rejection → `captureError(severity='fatal')`. On missing/incomplete subscribed_fields → `captureError(severity='error')`. Rows land in the God Mode `/errors` dashboard with full request context.
- **Operator recovery endpoints** ([src/http/adminKeyHttp.js](manicbot/src/http/adminKeyHttp.js)):
  - `POST /admin/ig-recover` — self-gated (no Bearer key). Refuses unless current encrypted token genuinely won't decrypt AND the supplied FB User Token's `/me/accounts` includes the stored `page_id`. Exchanges User Token → long-lived (60d) via `META_APP_ID + META_APP_SECRET`, derives a non-expiring Page Token, AES-GCM-encrypts, writes to D1, then immediately re-subscribes the Page.
  - `POST /admin/ig-app-subscribe` — re-registers the App-level webhook for `object=instagram`. No tenant data touched.
  - `POST /admin/ig-diag` — read-only diagnostic: returns `/me`, Page `subscribed_apps`, App-level `/subscriptions`, optional outbound test message to a PSID.
  - `POST /admin/ig-resubscribe` — Bearer-keyed batch re-subscribe across all/specific IG tenants.

### Worker var added

- `META_APP_ID` (public, in [wrangler.toml](manicbot/wrangler.toml) `[vars]`, paired with the existing `META_APP_SECRET` secret). Used by long-lived token exchange + App-level subscription management.

### Resolution: Instagram Login product migration

The root cause turned out to be a Meta-side API split (post-Mar-2026): Instagram Messaging moved off the Page Messenger model onto a separate **Instagram Login** product. Symptoms:
- Old Page Access Token (EAA…) stopped receiving DM webhooks
- App-level `object=instagram` + `messages` field needs Advanced Access which the legacy permissions track no longer grants
- New product has its OWN App ID (`3756985564432185`), its OWN App Secret (`META_INSTAGRAM_APP_SECRET` worker secret), and its OWN endpoint (`graph.instagram.com`)

Full recovery flow:

1. **Generate IGAA-prefixed token** in App Dashboard → Instagram → API setup with Instagram login → step 1 → Generate token. Add `dezbringer` as Instagram Tester in App Roles → Roles → invite → accept in IG app.
2. **POST /admin/ig-set-direct-token** with `{ tenantId, token }` — validates via `graph.instagram.com/me`, binds to stored `ig_business_id`, encrypts and writes; stamps `config.api = 'instagram_direct'`.
3. **Subscribe IG webhook fields**: `POST graph.instagram.com/v21.0/{ig_user_id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,messaging_seen,message_reactions&access_token=IGAA…`.
4. **Install `META_INSTAGRAM_APP_SECRET`** via `wrangler secret put`. `metaWebhooksHttp.js` tries `META_APP_SECRET` first, falls back to `META_INSTAGRAM_APP_SECRET`, and `captureError`s on full mismatch so future signature-secret rotations surface in the God Mode `/errors` dashboard.

### Outbound adapter routing

`channels/instagram.js` reads `config.api` at construction:
- **`'instagram_direct'`** → `graphPost` with `host: 'instagram'` (→ `graph.instagram.com`) and path `/me/messages`
- **otherwise (legacy)** → `host: 'facebook'` (→ `graph.facebook.com`) and path `/{pageId}/messages`

`channels/graph-api.js` exposes `graphBase(host)` and accepts `{ host }` opt on `graphPost`. Default `'facebook'` preserves backward-compat for every other caller (WhatsApp, legacy IG installs).

---

## Plugin Marketplace

1st-party extension system. Plugins are compile-time modules in `manicbot/plugins/<slug>/` with:

- `manifest.ts` (required — default export of a `PluginManifest`)
- optional `router.ts` (tRPC sub-router), `lifecycle.ts`, `health.ts`, `worker.ts`, `ui/SettingsPanel.tsx`
- localized `name / tagline / description / keywords` in all 4 languages (ru/ua/en/pl)

Key files:

- `manicbot/plugins/README.md` — full overview
- `manicbot/plugins/AUTHORING.md` — step-by-step authoring guide
- `manicbot/plugins/SECURITY.md` — enforcement invariants
- `manicbot/plugins/types.ts` — shared TypeScript types (no runtime deps)
- `manicbot/plugins/registry.ts` — static registry; one import per plugin
- `manicbot/admin-app/src/server/api/routers/plugins.ts` — tRPC CRUD (`install / uninstall / enable / disable / updateSettings / listCatalog / getInstalled / auditTrail / checkoutAddon`)
- `manicbot/admin-app/src/server/plugins/assertPluginEnabled.ts` — runtime guard (role + plan + billing)
- `manicbot/admin-app/src/server/plugins/manifestSchema.ts` — Zod validator
- `manicbot/admin-app/src/app/(dashboard)/plugins/` — marketplace UI (`/plugins` catalog + `/plugins/[slug]` detail)
- `manicbot/admin-app/src/app/(dashboard)/plugin/[slug]/` — runtime "Open" page (loads runtime via `runtimePanels`)
- `manicbot/admin-app/src/components/plugins/` — `PluginCard`, `LockedFeatureCard`, `PluginFilters`, `InstallConfirmModal`, `PluginIcon`, `PluginRuntimeShell`
- `manicbot/admin-app/src/components/plugins/runtimes/` — per-plugin runtime UI; every runtime MUST wrap its output in `PluginRuntimeShell` (manifest-driven icon + name + tagline). Enforced by `src/__tests__/plugin-runtime-architecture.test.ts`.
- `manicbot/admin-app/src/components/plugins/runtimePanels.ts` — runtime loader registry (`hasRuntime`, `loadRuntime`, `listRuntimeSlugs`)
- `manicbot/admin-app/src/lib/plugins/clientIndex.ts` — Fuse.js search index
- `manicbot/admin-app/src/components/settings/pluginPanels.ts` — registry of lazy-loaded settings panels
- `manicbot/src/billing/pluginWebhooks.js` — Stripe webhook → `plugin_installations.billing_state` mapping

Billing models: `free | included_in_plan (→ canUse) | paid_addon_monthly | paid_addon_onetime`. Paid addons go through Worker `POST /admin/plugin-addon-checkout` → Stripe Checkout; `price.metadata.plugin_slug` routes the webhook.

Lock precedence (catalog UI): `coming_soon` > `role_mismatch` > `platform_only` > `plan` > `none`.

Seed catalog (post 2026-05-16 Phase 1 cleanup + first Variant A wave + GCal restore): **10 first-party plugins** — 7 retained from the cleanup (loyalty-stamps, shift-planner, task-board, availability-share, earnings-goal, export-hub, message-templates), the restored **google-calendar** (manifest-only marketplace facade over the core OAuth flow — `googleCalendar.ts` router + `GoogleCalendarRuntime.tsx` were never removed during the cleanup, only the manifest was), plus two Variant A plugins: **review-collector** (free, post-visit 4★/5★ Google/Yandex CTA wired into [src/handlers/callback.js](manicbot/src/handlers/callback.js) via [src/plugins/reviewCollectorCta.js](manicbot/src/plugins/reviewCollectorCta.js)) and **inventory-lite** (free, JSON-backed inventory with low-stock highlighting, no D1 migration — fits ~80 items inside the 8 KB settings_json cap). 12 prior slugs were either duplicates of already-shipped core features (`booking-reminder`, `client-crm-lite`, `quick-notes`) or had their UI folded back into core (`ai-abuse-monitor`, `gdpr-center`, `sla-tracker`, `escalation-playbook`, `kb-search`, `ticket-templates`, `keyboard-shortcuts`, `dark-plus`, `portfolio-gallery`). The fold-into-core work itself ships in a follow-up PR — see [manicbot/plugins/registry.ts](manicbot/plugins/registry.ts) header + [manicbot/admin-app/src/__tests__/plugins-removed-duplicates.test.ts](manicbot/admin-app/src/__tests__/plugins-removed-duplicates.test.ts) for the full removed-slug list and rationale.

The Variant A roadmap (recommended for the next launch slot) adds 10 more plugins on top — including the platform's first `paid_addon_monthly` / `paid_addon_onetime` revenue lines: `sms-reminders` (hybrid BYO / Resale Premium billing), `review-collector`, `instagram-autopost`, `inventory-lite`, `loyalty-stamps` (real rebuild), `gift-cards`, `multi-location`, `accounting-export`, `domain-setup`, `data-migration`. Phase 2 plumbing must land before any of those plugins can ship a real backend — the four `PLUGIN_*_LOADERS` maps in `registry.ts` are currently empty and need to be wired through to the admin-app router and worker.

---

## God Mode Living Command Center

System-admin upgrades on top of the existing 11 God Mode pages:

- **Command Palette (Cmd+K)** — `CommandPalette.tsx` + `search.global` tRPC → cross-table fuzzy lookup (tenants / users / leads / marketing contacts)
- **Activity Feed** — right drawer in the `(dashboard)` layout, polls `events.getRecent` every 5s when open
- **Health Grid** — `HealthGrid.tsx` on the home dashboard; `system.getHealth` + plugin `checkHealth()` summaries
- **Plugin Marketplace** — `/plugins` (see above)

Both `CommandPalette` and `ActivityFeed` mount globally in `src/app/(dashboard)/layout.tsx` and render only when `role === "system_admin"`.

---

## Worker Architecture (`manicbot/src/`)

```
HTTP request → src/worker.js
  ├─ src/http/*              → match URL first (landing, Stripe, admin keys, Google OAuth, HTML admin, calendar, webhooks)
  ├─ src/http/resolveCtx.js  → getCtx() → tenant/resolver.js (POST /webhook/:botId or legacy /webhook)
  ├─ src/tenant/baseCtx.js   → shared env-spread (P2-4) consumed by both buildTenantCtx and buildChannelCtx
  └─ scheduled               → cron per tenant (D1) or legacy ctx
       └─ handlers/message.js, callback.js, inbound.js → onMsg / onCb (Telegram + WhatsApp/Instagram)
       └─ handlers/cron.js   ← scheduled tasks (every 15min)
                              orchestrator → phaseReminders / phaseReviews / phaseGcalSync /
                              phasePostVisit / phasePromos / phaseCleanup / phaseRetention.
                              Each idempotent via `tenant_config` key `cron:phase:{name}:last`.
                              phasePostVisit gated by `shouldAutoDonePostVisit` —
                              defers the T+24h auto-done when a real master's
                              Stage-1 prompt has not been delivered; hard cap
                              `POST_VISIT_HARD_CAP_SEC = 72h` so unreachable
                              masters never pin appointments forever. WA
                              reminder loop emits `wa.template.quota_exhausted`
                              when the plan's monthly template quota is used
                              up so the dashboard / Activity Feed surfaces it.
                              `error_log` retention is 90d (matches
                              `stripe_events` / `marketing_sends`).
```

### HTTP modules (`src/http/`)


| Module                   | Routes / role                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `envCtx.js`              | `{ db, kv, globalKv }` helper for handlers                                                       |
| `demoBots.js`            | Self-provision demo tenants/bots when env secrets `BOT_TOKEN_SALON*` etc. are set                |
| `resolveCtx.js`          | `getCtx(env, url, request)` — D1 webhook by `botId`, legacy `/webhook`, `REQUIRE_WEBHOOK_BOT_ID` |
| `landingHttp.js`         | GET paths proxied to `LANDING_URL`                                                               |
| `stripeHttp.js`          | `POST /stripe/webhook`, `GET /stripe/success`                                                    |
| `adminKeyHttp.js`        | `GET /admin/migrate`, `migrate-d1`, `seed`; `POST /admin/provision` (ADMIN_KEY)                  |
| `googleHttp.js`          | `/google/connect`, `callback`, `select`, `webhook`                                               |
| `adminPanelHttp.js`      | `GET /setup`, `remove-webhook`, `/admin`, `/admin/billing`, `/admin/export/*`                    |
| `calendarHttp.js`        | `GET /calendar/:aptId[.ics]`                                                                     |
| `telegramWebhookHttp.js` | `POST /webhook`, `POST /webhook/:botId` (excluding `wa` / `ig`)                                  |
| `metaWebhooksHttp.js`    | `GET                                                                                             |
| `trackHttp.js`           | `POST /api/track` — landing event ingest. Allowlisted event names, IP rate limit (60/min), 8 KB body cap, server-side consent gate (drops events when no `cookie_consent_log` row grants `analytics`). Always 204/400/429 — never echoes data. Pure logic in `trackHttpLogic.js`. |


### Key Files


| File                           | Purpose                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/worker.js`                | Entry point; delegates HTTP to `src/http/*.js`; `validateSecurityConfig()` startup checks                                       |
| `src/http/`                    | Isolated route handlers (see table above)                                                                                       |
| `src/handlers/message.js`      | Text message routing, AI chat trigger                                                                                           |
| `src/handlers/callback.js`     | Inline button callbacks                                                                                                         |
| `src/ai.js`                    | LLM integration (Cloudflare Workers AI, 3-model fallback) + AI input sanitization (`sanitizeUserInput`, `validateActionParams`) |
| `src/roles/roles.js`           | Role CRUD (D1) + helper functions                                                                                               |
| `src/services/users.js`        | isAdmin, isCreator, getRole, master CRUD                                                                                        |
| `src/services/appointments.js` | Booking CRUD, slot logic                                                                                                        |
| `src/billing/`                 | Stripe subscriptions, feature gating                                                                                            |
| `src/tenant/resolver.js`       | Multi-tenant routing                                                                                                            |
| `src/tenant/storage.js`        | D1-backed tenant/bot registry                                                                                                   |
| `src/support/tickets.js`       | Platform support tickets (global KV)                                                                                            |
| `src/services/tickets.js`      | Tenant-local support tickets                                                                                                    |
| `src/utils/kv.js`              | KV helpers — always use `kvGet/kvPut/kvDel`                                                                                     |


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


| Role                            | Dashboard         | Component                                            |
| ------------------------------- | ----------------- | ---------------------------------------------------- |
| `system_admin`                  | God Mode          | All existing pages (`/`, `/users`, `/tenants`, etc.) |
| `tenant_owner`                  | Salon Dashboard   | `SalonDashboard.tsx`                                 |
| `master`                        | Master Dashboard  | `MasterDashboard.tsx`                                |
| `support` / `technical_support` | Support Dashboard | `SupportDashboard.tsx`                               |


### Path Whitelist (when `{children}` renders instead of the role dashboard)

`(dashboard)/layout.tsx` swaps in the role-specific dashboard (`SalonDashboard` / `MasterDashboard` / `SupportDashboard`) for every URL **except** a small whitelist that renders the page-level `{children}` instead. Whitelisted paths:

- `/settings` (account / appearance / bot / billing / help — common to all roles)
- `/plugins`, `/plugins/*`, `/plugin/*` (Plugin Marketplace catalog, detail, runtime)
- `/marketing`, `/marketing/*` (Marketing module — `MarketingShell` with 7-tab sub-nav)

When adding a new top-level module that should not be intercepted by the role dashboard, extend the whitelist in `(dashboard)/layout.tsx` (currently four mirror blocks: `tenant_owner` / `tenant_manager` / `master` / `support`+`technical_support`). The whitelist logic is exercised by `src/__tests__/marketing-routing.test.ts`.


### tRPC procedures

- `**publicProcedure**` — no Telegram user required.
- `**protectedProcedure**` — valid `x-telegram-init-data`; sets `ctx.user`.
- `**adminProcedure**` — God Mode: `ADMIN_CHAT_ID` **or** `platform_roles.role` in `system_admin`  `support`  `technical_support` (see `server/api/platformRoles.ts` for the single source of truth). Same set is used by `support` router access checks.

### tRPC Routers


| Router           | File                        | Auth                                                                                                            |
| ---------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `auth`           | `routers/auth.ts`           | public (validates initData in ctx)                                                                              |
| `webUsers`       | `routers/webUsers.ts`       | mixed: public (register, verify, reset) / protected (changePassword, requestEmailChange) / admin (create, list) |
| `publicSalon`    | `routers/publicSalon.ts`    | public (salon directory: getProfile, search, getCities, autocomplete)                                           |
| `salon`          | `routers/salon.ts`          | `tenant_owner` for tenantId (`assertTenantOwner`)                                                               |
| `master`         | `routers/masterRouter.ts`   | `master` or `tenant_owner` for tenantId                                                                         |
| `support`        | `routers/support.ts`        | platform staff: `support` / `technical_support` / `system_admin` (via `platform_roles`)                         |
| `channels`       | `routers/channels.ts`       | protected + `assertTenantOwner`                                                                                 |
| `googleCalendar` | `routers/googleCalendar.ts` | protected + `assertTenantOwner`                                                                                 |
| `conversations`  | `routers/conversations.ts`  | protected + `assertTenantOwner`                                                                                 |
| `events`         | `routers/events.ts`         | adminProcedure (getRecent, clear — proxies to Worker)                                                           |
| `metrics`        | `routers/metrics.ts`        | adminProcedure                                                                                                  |
| `users`          | `routers/users.ts`          | adminProcedure                                                                                                  |
| `tenants`        | `routers/tenants.ts`        | adminProcedure                                                                                                  |
| `appointments`   | `routers/appointments.ts`   | mixed: read + bulk-status mutations are `adminProcedure` (God Mode); `createManual`, `rescheduleAppointment`, and `update` are `publicProcedure + assertTenantOwner` so the salon-dashboard panels (multi-master + personal-master) can call them. `update` is the explicit-Save path from the day-view detail panel — fires the Worker `reschedule` notification when the slot moves; `rescheduleAppointment` is the silent drag-to-move path. |
| `billing`        | `routers/billing.ts`        | adminProcedure                                                                                                  |
| `export`         | `routers/export.ts`         | adminProcedure                                                                                                  |
| `stripe`         | `routers/stripe.ts`         | adminProcedure                                                                                                  |
| `provisioning`   | `routers/provisioning.ts`   | adminProcedure                                                                                                  |
| `settings`       | `routers/settings.ts`       | adminProcedure                                                                                                  |
| `system`         | `routers/system.ts`         | adminProcedure                                                                                                  |
| `marketing`      | `routers/marketing.ts`      | adminProcedure (God Mode global CRM view — cross-tenant by design; UI consumed only by system_admin without a preview)                              |
| `marketingTenant`| `routers/marketingTenant.ts`| protected + `assertTenantOwner` — every procedure takes `tenantId` and filters every WHERE by `tenant_id`. Sibling to `marketing` for the salon-owner / tenant_manager / personal-master / sysadmin-previewing surface served by `/marketing/*`. Phase-1 surface: stats, contacts list/update, segments CRUD, templates CRUD, campaigns CRUD, providers (read-only), automations (stub). Send paths (`campaignSendNow`) still stubbed — real fan-out lands in PR 3 of the marketing roadmap.                              |
| `pluginReminders`| `routers/pluginReminders.ts`| managerProcedure + `assertTenantMember` + `assertPluginEnabled('reminders')`. CRUD + `listForCalendar` (expanded occurrences). `master` role can only edit own reminders (creator-id check). Recurrence validated by the shared `validateRecurrence` DSL helper (same code as Worker cron). |
| `notifications`  | `routers/notifications.ts`  | protectedProcedure. `list`, `unreadCount`, `markRead`, `markAllRead`, `dismiss`. All ops scoped by `ctx.webUser.id` — no cross-user reads. Consumed by `NotificationBell` in `Shell.tsx` (polls every 30s closed, 5s open). |
| `consent`        | `routers/consent.ts`        | mixed: `record` is public + rate-limited (anonymous landing visitors must log decisions); `getRecentDecisions` and `getCategoryAcceptanceRates` are admin (system_admin / support / technical_support). Pure helpers in `server/api/consent/consentLogic.ts`. |
| `ownership`      | `routers/ownership.ts`      | mixed: `requestTransfer` / `cancelTransfer` / `getPending` are `tenantOwnerProcedure` + `assertTenantOwner`; `confirmTransfer` is `publicProcedure` (the email recipient may not be logged in) but IP-rate-limited (20 / 10min) as defense-in-depth. Pure helpers in `server/api/ownership/ownershipLogic.ts` (`checkTransferEligibility` + `generateTransferToken` + `hashToken` + `isTokenExpired`). Backed by migration 0068. |
| `webUsers.getMyUiPrefs` / `setMyUiPrefs` | `routers/webUsers.ts` | protectedProcedure + `assertTenantMember`. JSON-blob storage in `tenant_config[ui_prefs:user:<webUserId>]` (8 KB cap). Per-tenant scoping so the same user keeps different sidebar layouts in different salons. Powers `useDashboardPrefs` server-sync (optimistic localStorage write-through + 400 ms debounced flush). |


### Key Components


| Component                         | Purpose                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `TelegramGate.tsx`                | Auth + role-based routing                                                          |
| `RoleContext.tsx`                 | React context: `{ role, tenantId, userId, hasPassword, emailVerified, billingStatus, isTrialExpired }` |
| `layout/Shell.tsx`                | Main layout (sidebar + mobile nav). Accepts `navItems`, `title`, `subtitle` props  |
| `EmailVerificationGate.tsx`       | Full-screen blocker when `emailVerified === false`. Whitelist: `/settings`.        |
| `BillingGate.tsx`                 | Full-screen blocker when `isTrialExpired === true` for `tenant_owner / tenant_manager / master`. Whitelist: `/billing`, `/settings`, `/plugins`, `/plugin/*`. Logic lives in `lib/billing/trialState.ts` (pure helpers, shared with the server-side lazy flip in `auth.getMyRole`). |
| `dashboards/SalonDashboard.tsx`   | Salon owner: Overview, Appointments, Masters, Services, Clients, Billing, Settings. `PublicProfileEditor` (inside this file) carries the salon-card form — slug/city/description/Maps/gallery PLUS Branding (logo, cover, brand palette), Contacts (address, phone, Instagram URL) and per-weekday Schedule (Mon..Sun, with day-off toggles). Per-day hours serialize to `{"days":{"mon":{"open":...,"close":...},...,"sun":null}}` via [lib/workHours.ts](manicbot/admin-app/src/lib/workHours.ts); 500-char cap in `updateSalonProfile`. |
| `dashboards/MasterDashboard.tsx`  | Master: Today, Schedule, Clients, Earnings, Profile. Schedule tab delegates to [`components/master/tabs/ScheduleTab.tsx`](manicbot/admin-app/src/components/master/tabs/ScheduleTab.tsx) which renders the SAME `SalonDayView` / `SalonWeekView` / `MonthCalendar` / `SalonAgendaView` stack as SalonDashboard, scoped to a single master column. Drag-to-reschedule goes through `appointments.rescheduleAppointment` (master role can move own bookings — see `routers/appointments.ts:525`); status mutations go through `master.markNoShow` (`onAction` left undefined since master role has no `appointments.updateStatus` analogue). Same surface served to owners viewing «as master» via the sidebar `previewMasterId` chip (layout.tsx swaps SalonDashboard → MasterDashboard) — fixes the regression where they used to land on the legacy `MonthCalendar` grid. |
| `dashboards/SupportDashboard.tsx` | Support: Ticket list + detail + reply + Claim/Escalate/Close                       |
| `salon/IGHealthCard.tsx`          | Live Instagram channel state (4-color: healthy / warning / needs_attention / broken). Reads `salon.getInstagramHealth` — fuses `channel_configs.active`, last `message_windows.last_user_message_at`, token age, and any open `error_events` IG row. Surfaces the silent-drop case where a dead Page token auto-flips `channel_configs.active = 0` and the resolver stops matching inbound webhooks. |
| `salon/SalonSettingsEditor.tsx`   | Salon-level config editor (name / display name / address / phone / hours / logo / cover / brand color). Used by both the `SalonDashboard` Settings tab AND `/settings?section=salon` — one source of truth. Extracted from the SalonDashboard monolith in PR #92. |
| `salon/AutoConfirmSettings.tsx`   | Per-channel auto-confirm toggles (web / telegram / whatsapp / instagram). Mirrored in `SalonDashboard` Settings tab and `/settings?section=salon`. |
| `salon/PublicProfileEditor.tsx`   | Public salon profile editor (slug / description / city / lat-lng / publicActive / photos). Used in both `SalonDashboard` `public_profile` tab and `/settings?section=public`. |
| `settings/SettingsShell.tsx`      | Horizontal top-tab strip (sticky, scroll-on-overflow, fade edges, chevron buttons on desktop). Replaces the previous left-rail. Section set varies by role: `tenant_owner` / `tenant_manager` get 8 (account / salon / public / team / channels / billing / appearance / help); `master` gets 4 (account / profile / appearance / help); platform staff get 3 (account / appearance / help); `system_admin` swaps in `platform`. |
| `settings/sections/MySalonSection.tsx` | Wrapper around `SalonSettingsEditor` + `AutoConfirmSettings` — the new "Мой салон" surface. |
| `settings/sections/TeamSection.tsx` | Team list + ownership-transfer block (the `ownership.requestTransfer` / `cancelTransfer` flow). Eligible recipients are masters with `webUserId !== null` in the same tenant. |
| `settings/sections/AppearanceSection.tsx` | Drag-to-reorder + pin-up-to-5 + visibility toggle editor for sidebar tabs. Uses `@dnd-kit/sortable`. Pin cap is centred toast on 6th attempt. "Plugins" is pinned to the bottom regardless of user choices. Backed by `useDashboardPrefs` (server-sync via `webUsers.getMyUiPrefs/setMyUiPrefs`). |
| `lib/useDashboardPrefs.ts`        | Source of truth for sidebar prefs. `applyTabPrefs(allTabs, prefs)` is a pure function (locked by `dashboard-prefs.test.ts`) that returns the final render order: pinned first → ordered → remaining; respects `alwaysVisible` ("overview" can never be hidden). |
| `salon/SalonChannelsTab.tsx`      | Salon-dashboard «Каналы» tab — 4 sub-tabs (Telegram / Instagram / WhatsApp / Веб-чат). Connect forms live on top; the «Как подключить …» guide (`BotFatherGuide`, `MetaGuide`) is always at the BOTTOM and starts collapsed. WhatsApp tab shows a green/amber status pill derived from `salon.getChannels` (presence of the WA row = Meta finished the verify-token handshake). «Веб-чат» sub-tab is the AI-chat surface — URL + QR point to `https://manicbot.com/salon/{slug}/chat`, with a same-origin `<iframe loading="lazy">` preview of the actual `/chat` page below. Embedding works because `middleware.ts` emits `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN` for `/salon/<slug>/chat` only (everything else stays DENY). |
| `dashboard-ui/AptCard.tsx`        | Appointment row used in agenda lists + today's-card. Right-side status pill is a `StatusActionMenu` trigger (not three inline buttons). Terminal rows (`cancelled / rejected / no_show / done`) stay visible but render with `opacity-50` + a non-interactive pill. |
| `dashboard-ui/StatusActionMenu.tsx` | Dropdown menu surface for `AptCard`. Per-status action matrix: `pending` → Confirm / Reject; `confirmed` → Cancel / Client no-show / Master no-show; terminal → read-only. Mirrors `FilterDropdown`'s keyboard-nav + outside-click pattern. |
| `dashboard-ui/AppointmentDetailPanel.tsx` | Rich bottom drawer that opens when a salon owner clicks an appointment in the day grid. Two-mode state machine: **read** (status badge, time + duration, client + channel chip, master, service + price, status quick-actions: Confirm/Done/Client-no-show/Master-no-show) and **edit** (date / time / master `Select` / service `Select`, conflict surfaced inline on save). Status quick-actions are hidden in edit mode so an in-flight save can't be clobbered. Delete uses brand-styled `ConfirmDialog` (danger tone) → soft-cancel via `updateStatus('cancelled')`. Save calls the new `appointments.update` mutation which fires a Worker `reschedule` notification only when the client-visible slot moves. Past-event dimming is driven by `useNowTicker` via `SalonDayView` (60s cadence, `opacity-70 saturate-50` for past, `opacity-40` for cancelled). |
| `lib/useNowTicker.ts`             | Shared "current time" hook (`Date.now()` returned, re-renders every `intervalMs`, default 60s). Single source for both the red `now` line marker in `SalonDayView` and the past-event dimming so they move in lockstep. |
| `dashboard/OnboardingChecklist.tsx` | Single setup checklist on the Overview tab. Replaces the legacy two-widget stack (`OnboardingChecklist` + `ProfileCompletenessCard`) — `STEP_IDS` is 10 items, auto-hides at 10/10. The four new ids (`fill_description / add_logo / add_cover / activate_public`) are derived from the `tenants` table by `onboarding.getStatus`. |


### Salon Dashboard 2026-05-16 cleanup

Overview tab was over-busy with two stacked setup widgets + a 4-card stat
grid + a global "+ Новая запись" FAB that bled onto unrelated tabs. The
2026-05-16 cleanup:

- **Merged** `ProfileCompletenessCard` into `OnboardingChecklist`; the
  card + its test are deleted. `STEP_IDS` extended 6 → 10. Auto-hides
  when 10/10 done.
- **Removed** the stat grid (today / masters / open tickets / billing
  plan). The same numbers live in their dedicated tabs and the sidebar
  badge; the Overview tab is for setup progress + today's schedule, not
  KPIs.
- **Today's appointments** card uncapped (no more "+5 записи" expander)
  and sorted descending by time.
- **`+ Новая запись` FAB** restricted to `tab === "appointments"` only.
- **`AptCard`** redesigned: three inline action buttons replaced by the
  status pill itself (a `StatusActionMenu` dropdown). Cancelled / no-show
  / rejected / done rows are dimmed (`opacity-50`) but not removed —
  matches Google Calendar's "show but de-emphasize" pattern.

The `dashPrefs.hiddenStatCards` preference field stays in
`useDashboardPrefs.ts` (and `AppearanceSection` still renders the
toggles) but they no longer affect the dashboard. Cleaning that up is a
follow-up; it's harmless because the stat grid is unconditionally gone
from `SalonDashboard.tsx`.


### Appointment status transitions (Day-view detail panel — 2026-05-16)

Single dispatch path for every status flip on the rich
`AppointmentDetailPanel`. Previously the panel called
`api.appointments.updateStatus` + `markNoShow` — both `adminProcedure`
(system_admin / support / technical_support only), so every click from a
salon owner silently 403'd. The fix introduces tenant-scoped equivalents
and routes new "done" / "no-show" actions through a unified Worker
dispatcher so post-visit copy lives in ONE place (the marketing module
override or the built-in default), never duplicated across routers.

**tRPC (admin-app):**
- `salon.confirmAppointment` (tenantOwnerProcedure) — `pending → confirmed`
- `salon.rejectAppointment` (tenantOwnerProcedure) — `pending → rejected`
- `salon.markDone` (tenantOwnerProcedure) — `confirmed → done`,
  **refuses with `cannot_mark_done_before_start` if `apt.ts > now`**
- `salon.markNoShow` / `salon.cancelAppointment` — existing; now also fire
  `notifyWorker` so the client gets the correct message instead of silent
  D1 write.
- `master.confirmAppointment` / `master.markDone` — symmetric for the
  master role, enforcing the per-master IDOR guard
  (`assertCallerIsMaster`) when the caller is a salon-employed master.
- `appointments.updateStatus` / `appointments.markNoShow` stay
  `adminProcedure` (the legacy God Mode `/appointments` page still uses
  them). Don't reach for them from tenant-scoped UI.

**Worker (`POST /admin/appointment-action`):**
- New actions: `done`, `no_show_client`, `no_show_master`. Each routes
  through `src/services/appointmentAutomations.js`
  → `dispatchAppointmentAutomation(ctx, apt, eventType)`.
- The dispatcher does deterministic side-effects (`lifetime_visits++` on
  done, reminder cleanup, analytics_events row), counts matching
  `marketing_automations` rows (for the marketing engine wired in a
  follow-up), and ALWAYS sends a built-in default unless the caller
  passes `{ suppressDefault: true }` (sentinel for a marketing-automation
  override in PR 3+).
- Default copy per event lives once in `appointmentAutomations.js`:
  thank-you+review for `appointment.done`, apology+rebook button for
  `appointment.no_show_master`, **silent** for
  `appointment.no_show_client` (the client may take offense at "you
  didn't show"; the dispatcher still writes the analytics row).
- Unknown actions now return `400 UNKNOWN_APPOINTMENT_ACTION`.

**Shared helper:** `~/server/utils/notifyWorker.ts` (typed
`AppointmentAction` union). Lifted out of `appointments.ts` so
salon/master/appointments routers can all import without circular deps.

**Frontend:** `AppointmentDetailPanel.tsx` — pill-buttons disabled while
any mutation is pending; "Mark Done" disabled until `apt.ts <= now` with
a tooltip; errors mapped to localized strings
(`salon.day.panel.doneNotYet` / `invalidStatusTransition`). Buttons stack
into a 2-column grid on phones (`grid-cols-2 sm:flex`) with `min-h-11`
tap targets.

### Drag-to-reschedule (Day / Week calendar grids)

Google-Calendar-style drag-to-move on appointment blocks in
`SalonDayView` and `SalonWeekView`. Snaps to 15-min increments, supports
cross-master and cross-day drops, optimistic UI with rollback on slot
conflict.

**tRPC:** `appointments.rescheduleAppointment` (input: `tenantId`,
`appointmentId`, `newDate`, `newTime`, optional `newMasterId`). Re-uses
`slotsBusy({ excludeAppointmentId })` for the conflict guard, refuses
terminal rows (`appointment_terminal`), resets `syncRetries /
syncRetryAfter / syncLastError` so `phaseGcalSync` re-syncs the Google
Calendar event at the new time, and re-arms `remH24 / remH2 = 0` so the
reminder cron fires for the new time, not the old one. Worker notify is
intentionally NOT triggered — small reschedules during the day shouldn't
spam clients with "your appointment moved" messages.

**Frontend primitives:**
- [lib/calendar/useDragToMove.ts](manicbot/admin-app/src/lib/calendar/useDragToMove.ts) — hook
  (mirror of `useDragToCreate`) wired to a single appointment block.
  `bindBlock()` returns `onPointerDown + touchAction: 'none'` for each
  block; `ghost` + `draggingId` drive the dragging-source fade and the
  destination ghost. Column resolution at pointer position uses
  `document.elementsFromPoint().closest('[data-day]')`.
- [components/dashboards/SalonDayView.tsx](manicbot/admin-app/src/components/dashboards/SalonDayView.tsx) — each master column carries
  `data-day={isoDate}` + `data-master-id={chatId}` (synthetic
  Unassigned column `chatId=-1` deliberately omits `data-day` so it's
  not a drop target).
- [components/dashboards/SalonWeekView.tsx](manicbot/admin-app/src/components/dashboards/SalonWeekView.tsx) — each day column carries
  `data-day={iso}` only. Cross-master moves are not possible in the
  Week view by design (the column is per-day, not per-master).
- [components/dashboards/SalonDashboard.tsx](manicbot/admin-app/src/components/dashboards/SalonDashboard.tsx) — owns the `rescheduleApt`
  mutation + a local `pendingMoves` state. `applyPendingMoves()` layers
  in-flight moves onto the appointment arrays before they reach the
  views so the dragged block visually settles at the new slot
  immediately; the mutation's `onSettled` invalidates the cache to
  land canonical data.

**Permissions:** owner can move any appointment to any master. Master
role (web session) can only move their OWN appointments and cannot
reassign to another master — same role-scoping rule as
`appointments.createManual`.


### Web User Authentication (`server/auth/`, `server/email/`)

Email/password auth for the web admin panel (separate from Telegram Mini App HMAC auth).

```
Browser → (auth)/register → webUsers.register
  → hashPassword (PBKDF2-SHA256, 100k iterations, 16-byte salt)
  → sendVerificationCodeEmail (Resend) → 6-digit code (15min TTL)
  → (auth)/verify-email?email=xxx → webUsers.verifyEmail (code input)
  → auto-login via stored password (sessionStorage)
  → sendWelcomeEmail (fire-and-forget)

Google OAuth registration (passwordless):
  → Google OAuth → NextAuth signIn callback
  → New user: signGooglePrefillToken → redirect /register?g=token
  → Email pre-filled + locked, password fields hidden
  → Register with NULL passwordHash → verify email → Google session
  → Dashboard shows SetPasswordBanner → /settings → setInitialPassword

Password reset:
  → (auth)/forgot-password → webUsers.requestPasswordReset → 1h token
  → (auth)/reset-password?token=xxx → webUsers.resetPassword
```

**Google registration specifics:**

- `password_hash` is nullable in `web_users` — Google users may have NULL
- `auth.getMyRole` returns `hasPassword: boolean` — drives UI banners
- `SetPasswordBanner` component shown in dashboard for users without password
- `webUsers.setInitialPassword` — sets password for first time (no current password needed)
- `AccountSection` shows "Set Password" vs "Change Password" based on `hasPassword`

**Key modules:**


| Module                         | Purpose                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `server/auth/password.ts`      | PBKDF2-SHA256 hashing (Web Crypto API, edge-compatible)                         |
| `server/auth/authBaseUrl.ts`   | Resolves public URL for email links (AUTH_URL / NEXTAUTH_URL / VERCEL_URL)      |
| `server/email/emailService.ts` | 5 email types: verification, password_reset, welcome, email_change, login_alert |
| `server/email/templates.ts`    | Branded HTML templates with i18n (ru/ua/en/pl)                                  |
| `server/email/resend.ts`       | Resend HTTP transport (`RESEND_API_KEY`, `RESEND_FROM`)                         |


**Auth pages** (`app/(auth)/`): `register`, `login`, `forgot-password`, `reset-password`, `verify-email`, `confirm-email-change`

**Security:**

- Rate limiting: 5 attempts / 10 min per IP (in-memory, resets per isolate)
- Brute-force: 5 failed logins → 15-min lockout (`login_attempts`, `locked_until` columns)
- Login alerts: email on new IP (`last_login_ip`, `last_login_at`)
- Password min length: 12 characters
- Constant-time password comparison

---

## Customizable mobile bottom-nav (2026-05-16)

Both shells — `WebShell` (web admin, `lg:` 1024px breakpoint — iPad portrait
falls into mobile) and `Shell` (Telegram Mini App, `md:` 768px) — now read
the user's saved bottom-nav order from `useDashboardPrefs()` instead of
slicing the first 5 nav items themselves.

**Hook:** `manicbot/admin-app/src/lib/useDashboardPrefs.ts` extends the
`DashboardPrefs` interface with `bottomNavOrder: string[]` and
`bottomNavLayout: "default" | "custom"`. `BOTTOM_NAV_LIMIT = 5` is the
documented cap. `setBottomNav(order)` dedupes, clamps, and switches the
layout flag to `"custom"`; `resetBottomNav()` returns to the role
default. Persistence is tenant-scoped localStorage — same pattern as
the existing `hiddenTabs` field, no migration needed.

**Derivation:** `useNavItems()` now returns `mobileNav: NavItem[]` in
addition to the existing `groups / flat / settings`. `mobileNav` is the
ordered list rendered in the mobile bottom-bar. When `bottomNavLayout
=== "default"` it's the legacy "first 4 + Settings" slice (zero
regression); when `"custom"` it honours `bottomNavOrder`, filters
against current role-allowed items (so a hidden tab can't resurrect via
a stale customisation), and always appends Settings as the chrome
safety belt — the user cannot lock themselves out of the settings panel
that controls this preference.

**Settings UI:** `AppearanceSection.tsx` gains a fourth section
"Нижняя навигация (мобильная)" — toggle visibility per item, drag-handle
+ up/down chevrons for reorder, locked Settings row at the top, live
preview of the bar, "Сбросить в стандартный порядок" button. Drag uses
inline pointer events (no `dnd-kit` dep). Capacity counter (`N / 5`)
plus FIFO behaviour at cap with a localized warning string.

---

## Local checks (before deploy)

```bash
cd manicbot/
npm test                     # Worker Vitest (~2038 tests, 150 files)
npm run check-schema         # D1: table + column parity between schema.sql and Drizzle schema.ts

cd admin-app/
npm run typecheck
npm test                     # Mini App Vitest (~3635 tests, 116 files)
```

GitHub Actions `test` job runs the same checks (Worker tests + `check-schema` + admin-app typecheck + tests) before Worker/Pages deploys.

### Test accounts

Reproducible 8-account roster for billing/role/catalog regression — see [TEST_ACCOUNTS.md](TEST_ACCOUNTS.md).
Pre-deployed by `cd manicbot && npm run seed:test-accounts` (idempotent; emits SQL via `wrangler d1 execute --remote`).

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

**Meta channels** (WhatsApp / Instagram via `[metaWebhooksHttp.js](manicbot/src/http/metaWebhooksHttp.js)`):

- `META_APP_SECRET` — must match the Meta app; required for signed POST webhooks (otherwise 403).
- `META_VERIFY_TOKEN_WA`, `META_VERIFY_TOKEN_IG` — webhook verification; same values on Pages for Mini App hints.
- `BOT_ENCRYPTION_KEY` — recommended (startup `[SECURITY]` warning if missing); decrypts `channel_configs.token_encrypted` for outbound Graph calls. When set, plaintext fallback is disabled for channel tokens.
- Optional: `INSTAGRAM_IGNORE_SENDER_IDS`, `INSTAGRAM_AI_TRIGGER` — see [META_CHANNELS_SETUP.md](manicbot/META_CHANNELS_SETUP.md).

**Outbound Instagram** uses `graph.facebook.com` + Page ID + Page access token (`[channels/instagram.js](manicbot/src/channels/instagram.js)`); `**entry.id`** is matched to `page_id` / `instagram_business_id` / `ig_account_id` in D1 (`[channels/resolver.js](manicbot/src/channels/resolver.js)`).

**Inbound dedup (all channels)** — Meta retries WA/IG webhooks for up to 24h on 5xx; Telegram retries for ~10min. Each channel claims a KV key before any handler work so a retry is a 200 ack with no replay:
- Telegram: `tg:upd:{botId}:{updateId}` (5min TTL) — `claimTelegramUpdate` in `[utils/dedup.js](manicbot/src/utils/dedup.js)`.
- Instagram: `ig:msg:{pageId}:{mid}` (24h TTL) — `claimMetaMessage`.
- WhatsApp: `wa:msg:{phoneNumberId}:{wamid}` (24h TTL) — `claimWAMessage`. Claim runs **before** tenant resolution so unknown-tenant retries don't burn DB lookups.

**Outbound 24h-window guard (WA/IG)** — `WhatsAppAdapter.send` and `InstagramAdapter.send` both refuse free-form sends outside the Meta 24h messaging window (`isWithinMessageWindow` check in `[handlers/inbound.js](manicbot/src/handlers/inbound.js)`). Return shape: `{ ok: false, error: 'outside_message_window' }`. Outside the window the caller must switch to a pre-approved WA template (`[channels/whatsapp-templates.js](manicbot/src/channels/whatsapp-templates.js)`) — IG has no template fallback. The cron reminder loop emits `wa.template.quota_exhausted` when both gates fail (outside window AND no template quota) so the dashboard surfaces it.

**IG E2E fixture:** `cd manicbot && npm run ig-e2e:tenant -- --owner=TG_USER_ID --bot-id=BOT_ID` (optional `--dry-run` / `--local`) — see `[META_CHANNELS_SETUP.md](manicbot/META_CHANNELS_SETUP.md)` § «Тестовый тенант для E2E».

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
- `WORKER_PUBLIC_URL` — public URL of the Worker (e.g. `https://manicbot.com`). Required for Google Calendar OAuth — the admin-app uses it to build absolute `/google/connect` redirect URLs that the Worker can resolve. Without it, GCal connect 500s.
- `DATABASE_URL` (optional, for local dev with LibSQL)
- `BREVO_API_KEY` (optional — dormant marketing provider; see [PROVIDERS.md](manicbot/admin-app/src/server/email/PROVIDERS.md))
- `BREVO_FROM` (optional — Brevo sender, same format as `RESEND_FROM`)
- `BREVO_SMS_SENDER` (optional — SMS sender ID, 11 chars max; used by Max-plan SMS add-on)

**DNS / email deliverability** (P2-17, relax.md §3): see [manicbot/docs/dns/DMARC.md](manicbot/docs/dns/DMARC.md) for the DMARC `rua=postmaster@manicbot.com` reporting setup — operator-facing runbook for the Cloudflare DNS dashboard. No CLI tooling is required.

---

## D1 Schema Key Tables


| Table                      | Purpose                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `tenants`                  | Salon registrations (id, name, plan, billing_status)                                              |
| `bots`                     | Bot registrations (bot_id, tenant_id, webhook_secret)                                             |
| `tenant_roles`             | tenant_owner / master assignments per tenant                                                      |
| `platform_roles`           | system_admin / support / technical_support (platform-wide)                                        |
| `appointments`             | All bookings (tenant-scoped); sync columns: `sync_retries`, `sync_retry_after`, `sync_last_error` |
| `masters`                  | Master profiles (tenant-scoped)                                                                   |
| `services`                 | Service catalog (tenant-scoped)                                                                   |
| `users`                    | Client registrations (tenant-scoped)                                                              |
| `platform_tickets`         | Platform support tickets                                                                          |
| `platform_ticket_messages` | Messages per platform ticket                                                                      |
| `local_tickets`            | Tenant-local support tickets                                                                      |
| `tenant_config`            | Key-value config per tenant (salon_name, address, work_hours, etc.)                               |
| `support_agents`           | Platform support agents (type: 'support' or 'technical_support')                                  |
| `channel_configs`          | WhatsApp / Instagram bindings per tenant                                                          |
| `conversations`            | Unified inbox rows (омниканал)                                                                    |
| `message_windows`          | Last user message time (WA/IG 24h policy)                                                         |
| `google_integrations`      | Tenant/master Google OAuth integrations + sync status                                             |
| `google_busy_blocks`       | Cached external busy windows loaded from Google Calendar                                          |
| `web_users`                | Web panel accounts (email/password auth, verification tokens, brute-force tracking)               |
| `cookie_consent_log`       | APPEND-ONLY audit trail of cookie banner decisions (anonymous_id, categories JSON, policy version, source, ip, ua) |


---

## Billing Plans


| Plan    | Price    | Masters   | Features                                      |
| ------- | -------- | --------- | --------------------------------------------- |
| `start` | 45 zł/mo | 1         | Basic booking                                 |
| `pro`   | 60 zł/mo | 5         | AI assistant, support agents, Google Calendar |
| `max`   | 90 zł/mo | Unlimited | All features, white label                     |


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

