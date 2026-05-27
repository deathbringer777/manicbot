# ManicBot — Architecture Reference

## Working with the user (read first)

- **Read the user's initial message in full before doing anything.** Don't skim, don't compress, don't drop details. If the request has multiple parts, address every part — not just the first or the most obvious.
- **Do not optimize for brevity at the cost of fidelity.** If the prompt asks for X, Y, and Z, deliver X, Y, and Z. Saving output tokens by skipping pieces of the request is a failure mode, not a feature.
- **Restate the ask only when ambiguous.** Otherwise just do the work — the user runs in autonomy mode (no confirmation pauses for commit/push/deploy/migrate).
- **If you skip something on purpose** (out of scope, blocked, won't fix), say so explicitly. Silent omission = bug.
- **Re-read context before assuming.** When a long CLAUDE.md / system reminder / file is in scope, scan for the relevant section instead of answering from a guess at the middle.

## Task structuring (treat every non-trivial ask as a workflow)

Before coding, mentally fill out a `task.md`: **Goal** (one sentence — what does "done" look like?), **Context** (which files / past decisions matter?), **Constraints** (what must NOT change — compat, scope, security), **Success criteria** (concrete, checkable), **Verification** (how you'll prove it works).

Then follow the sequence:

1. **Separate goal, context, and constraints when reading the prompt.** Don't conflate "what" with "how" with "off-limits." Mixing them is why edits drift into out-of-scope refactors.
2. **State the success criterion upfront** — write it down before the first edit. If the user didn't give one, infer the smallest checkable thing (a specific test passing, a specific UI flow working, a specific log line appearing) and name it explicitly.
3. **Propose the plan in one or two sentences, then execute.** Autonomy mode means don't pause for approval — but a brief plan-before-edit lets the user redirect if you misread the ask. Ask only when truly blocked (decision the user must own, missing input, conflicting constraints).
4. **Break complex edits into stages.** Migration → router → UI as separate logical units; verify each before stacking the next. A 20-file change that breaks at file 3 wastes the other 17. Same rule applies to large refactors — slice by layer or by feature, not "all at once."
5. **After the fix, run the verification — don't write a pretty explanation.** Type-check, run the test, reload the preview, query D1, hit the endpoint. Show the output (or describe what you saw). "Should work" / "this looks correct" is not done. If you can't verify (no preview, no test harness for that surface), say so explicitly instead of claiming success.

## Reasoning budget (don't skimp on hard code)

Reasoning level is set at invocation (`low / med / high / xhigh / max / ultrathink`) — Claude doesn't pick it. Within whatever budget is given:

- **Don't artificially shorten thinking on hard code.** Truncating reasoning to "save tokens" produces sloppy edits, missed edge cases, and wrong root-cause guesses. Pour reasoning into refactors, debugging, cross-file consistency, security boundaries.
- **Match effort to task complexity.** Typos / one-line edits / known-pattern lookups don't need elaborate thinking — keep it tight there so the heavy budget is available when it matters.
- **Flag a reasoning mismatch only when actually blocking.** If a task really wants `xhigh` / `ultrathink` and the invocation feels lower, say so once ("this is a hard refactor — better at xhigh") and proceed with what you have. Don't preface every routine reply with "I'd think harder if you bumped me."

User-side cheatsheet (which level to invoke at):

- simple / one-liners → `low` / `med`
- code review / debug-explain → `high`
- hard refactor / new architecture → `xhigh`
- deep pass (full repo audit, novel design, multi-system migration) → `max` / `ultrathink`
- always: verify after fix

Reminder: reasoning level alone doesn't save bad instructions. Big-think mode is multiplicative with the Task-structuring rules above (Goal / Context / Constraints / Success criteria / Verification) — not a substitute for them.

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
- `0067_messenger.sql` — schema-only foundation for the internal messenger: `threads` (kind ∈ `staff_dm | staff_group | client_conv | system`, partial UNIQUE on (tenant, dm_key) WHERE staff_dm, partial UNIQUE on (tenant, client_conversation_id) so each existing `conversations` row mirrors into exactly one thread), `thread_members` (`member_kind ∈ web_user | external_client | master`, with `last_read_message_id` for per-user read state; the **`master`** kind was introduced in the 2026-05-26 staff-visibility PR for placeholder DM rows when a salon master has no web account yet — backfilled to `web_user` once they link one, see [src/server/messenger/linkMasterPlaceholder.ts](manicbot/admin-app/src/server/messenger/linkMasterPlaceholder.ts)), `thread_messages` (ULID PK → lexicographic = chronological ordering; tenant_id denormalized for isolation defense).
- `0070_reminders_and_notifications.sql` — three new tables that power the **Reminders plugin** + the **platform-wide in-app notification bell**:
  - `plugin_reminders` — per-tenant reminder/routine definitions. Recurrence is stored as JSON validated by zod at the tRPC boundary (`~/lib/recurrence.ts` shared with the Worker via JS mirror at `src/lib/recurrence.js`); supported DSL is `once | daily | weekly | monthly_day`. `kind ∈ {reminder, routine}` is a UI-only label, both go through the same fire path. `target_master_id` null = owner/unassigned column. `channels_json` is a subset of `["inapp", "telegram"]`. Soft-delete via `archived_at`.
  - `plugin_reminder_fires` — append-only fire log + idempotency claim. The UNIQUE `(reminder_id, fires_at_epoch)` index IS the contract: `INSERT OR IGNORE` in the cron loop returns `changes=0` if a previous tick already fired the same occurrence. `delivery_state ∈ {pending, sent, failed}`.
  - `user_notifications` — generic platform-wide in-app feed consumed by `NotificationBell` in `Shell.tsx` (header). The reminders plugin is the first writer (`kind='reminder.fired'`); future features (checklists, billing alerts) write into the same table — no router changes needed. Partial UNIQUE `(web_user_id, source_slug, source_id, kind)` dedups bell entries on cron retry.

  Powers the new **Worker plugin-cron runtime**: `src/handlers/cron.js` exposes a static `PLUGIN_CRON_DISPATCHERS` map (currently `{ reminders: remindersCron }`) consumed by the new `phasePluginCron` orchestrator phase. The orchestrator loops `plugin_installations` for the current tenant where `enabled=1`, skips paid-addon installs in `past_due`/`canceled`, and dispatches to the slug's handler inside a try/catch so a misbehaving plugin cannot break siblings or the rest of the orchestrator. Adding a future cron plugin = one new import + one entry in `PLUGIN_CRON_DISPATCHERS` (plus the plugin's own `cron.js` handler).

  New helper: `src/services/userNotify.js` — multi-channel notification fanout. Always writes in-app (unless `opts.inapp=false`). Optional Telegram dup gated on the target having a non-synthetic master row (`masters.web_user_id`-linked, `is_synthetic=0`, `chat_id` outside the 10B+ synthetic range). Idempotent on the in-app side via the partial UNIQUE described above when `sourceSlug` + `sourceId` are passed.
- `0071_ownership_transfer_tokens.sql` — single-use, 24h-TTL tokens for self-serve tenant-ownership handoff. Owner initiates → row created + email to current owner's inbox with the raw token → confirmation flips `tenant_roles` and `web_users.role` in a single transaction (target → `tenant_owner`, old owner → `master` with synthetic `chat_id`). Partial UNIQUE index `idx_ott_one_pending ON ownership_transfer_tokens(tenant_id) WHERE consumed_at IS NULL AND cancelled_at IS NULL` enforces "at most one in-flight request per tenant" at the DB level — the in-process check in `requestTransfer` gives a friendlier error than a unique-violation, but the index is the durable invariant. Powers tRPC `ownership` router (`requestTransfer` / `confirmTransfer` / `cancelTransfer` / `getPending`) + the public `/ownership/confirm?token=…` route. Eligibility (`checkTransferEligibility`) is re-checked at confirm-time so a downgrade since the request can't bypass the gate. `confirmTransfer` is IP-rate-limited (20/10min) as defense-in-depth even though tokens carry ~190 bits of entropy. Backend tests: `ownership-logic.test.ts` (22 cases: happy path + 5 rejection paths + token-gen entropy + hash determinism + expiry edge), `ui-prefs-tenant-isolation.test.ts` (7 cases asserting `assertTenantMember` rejects cross-tenant probes via the new UI-prefs endpoint), `settings-shell-sections.test.tsx` (locks the 8-section contract for `tenant_owner` / `tenant_manager` and the top-tab layout).
- `0079_user_avatar.sql` — three nullable columns on `users` (`avatar_emoji`, `avatar_url`, `avatar_r2_key`) so the Salon Clients tab can render a real avatar instead of the legacy first-letter chip. Photo wins over emoji when both are set; the picker enforces this by always writing the unused field as `NULL` (re-enforced server-side in `clients.update`). New shared helper `~/lib/clientAvatar.ts` exports `DEFAULT_CLIENT_EMOJI = '👩'` + a curated 40-emoji palette (queens, princesses, fairies, crowns, flowers, hearts, playful animals); `resolveAvatarEmoji()` returns the saved value or the default. Picker component `ClientAvatarPicker.tsx` opens as a nested `z-[110]` modal on top of `ClientDetailModal` — two tabs (Эмодзи / Фото), photo upload uses `salon.mintUploadToken({ kind: 'client_avatar' })` (new enum member in both `~/server/lib/uploadToken.ts` and Worker `src/services/upload.js`) and square-center-crops the source file client-side to 512×512 WebP before upload so the round avatar has no awkward edges. CSV export is now format-aware (`clients.exportCsv.format ∈ 'manicbot' | 'google' | 'apple'`) — see `~/server/clients/csv.ts` (`clientsToFormat`, `clientsToGoogleCsv`, `clientsToVcard`). Google CSV uses First/Last/E-mail 1 - Value/Phone 1 - Value/Birthday/Notes/Labels with Telegram/Instagram handles buried in Notes; Apple export is vCard 3.0 (one block per client, `X-TELEGRAM` / `X-INSTAGRAM` custom props for handle round-trip). Import auto-detects format: a `BEGIN:VCARD` prefix routes through the vCard parser, otherwise the CSV path recognizes Google's header aliases. UI: `ClientsTab` Export button became a dropdown with three format choices. Tests: `csv-clients.test.ts` (+ Google + vCard parse / emit / round-trip), `clientAvatar.test.ts` (helper pin), `ClientAvatarPicker.test.tsx` (RTL contract), `ClientRow.test.tsx` updated to assert emoji/photo instead of initial.
- `0087_subscription_cancellations.sql` — cancellation retention flow audit trail. One row per cancel attempt (accepted-offer OR confirmed-cancel) so we can measure offer acceptance rate, cluster churn reasons, and enforce a 12-month cooldown on the discount. Columns: `tenant_id`, `web_user_id`, `plan_at_cancel`, `interval_at_cancel`, `reason_tags` (JSON array of `too_expensive | no_clients | confusing_ui | bad_support | switched_competitor | temporary_break | other`), `free_text`, `photo_url` (R2-hostname-validated server-side), `retention_offer_shown / accepted` flags, `retention_coupon_code`, `created_at`. Powers the 3-stage `RetentionFlow.tsx` modal that intercepts the previously direct-to-Stripe "Cancel subscription" intent. tRPC additions to `billingRouter` (`tenantOwnerProcedure`): `requestCancellation` (eligibility probe → returns `{eligibleForOffer, offerType: 'monthly_50_3m' | 'annual_25_1y' | null, currentPlan, currentInterval, stripeSubId}`; detects interval from Stripe `subscription.items[0].price.recurring.interval`), `acceptRetentionOffer` (mints idempotent coupon via new Worker `ensureCoupon` helper in `src/billing/stripe.js` + admin-app mirror in `~/server/lib/stripe.ts`, applies to subscription, writes audit row with `retention_offer_accepted=1`, does NOT cancel), `confirmCancellation` (writes audit row BEFORE Stripe call so a Stripe failure cannot leave an unrecorded cancel, flips `cancel_at_period_end: true`, mirrors locally, fires fire-and-forget "sorry to see you go" email). New `ALLOWED_KINDS` member `cancellation_feedback` on both Worker `src/services/upload.js` and admin-app `~/server/lib/uploadToken.ts` powers optional photo upload via existing `salon.mintUploadToken` proc. Coupon codes hardcoded: `RETENTION_MONTHLY_50_3M` (50% repeating × 3mo) / `RETENTION_ANNUAL_25_1Y` (25% once). Test coverage: `test/stripe-coupon-idempotency.test.js` (6 cases — GET-first / 400-conflict re-GET / annual duration=once / auth header), `src/__tests__/cancellation-retention-router.test.ts` (29 cases — auth gating, all eligibility branches incl. 12-month cooldown + already-cancelling + past_due + missing-sub, coupon idempotency mock, audit-first ordering, photo URL host whitelist, Stripe failure → no orphan tenant flip), `src/__tests__/RetentionFlow.test.tsx` (19 cases — 3-stage transitions, ESC closes Stage 1/2 but NOT Stage 3, photo upload chip, advance gate requires ≥1 reason). Modal pinned in `modal-styling-regression.test.ts` (`src/components/billing/RetentionFlow.tsx`). Mounted from `~/components/settings/sections/BillingSection.tsx` — the historical Stripe Customer Portal "Manage subscription" path stays for invoice/payment-method management; the explicit cancel intent is now unreachable except through the retention flow.
- `0084_platform_config.sql` — `platform_config(key, value, updated_at, updated_by)` — key/value store for platform-wide settings that don't belong to any tenant (SEO audit 2026-05-20). First consumer is the `/about` page (founder name, year founded, jurisdiction, support contacts, multi-lang taglines/missions); read via `publicProcedure platformConfig.getAbout`, written via `adminProcedure platformConfig.setAbout`. Defaults live in [server/api/routers/platformConfig.ts](manicbot/admin-app/src/server/api/routers/platformConfig.ts) `ABOUT_DEFAULTS` so the page never 500s on a fresh install — the row is only written when an admin saves. Editor UI at `/system/about` (system_admin only). (Originally numbered 0083 locally and applied to prod under that name before the blog CMS PR landed first; renamed to 0084 — the prod `d1_migrations` table records BOTH `0083_platform_config.sql` AND `0084_platform_config.sql` due to the rename, but the `CREATE TABLE IF NOT EXISTS` makes the second apply a safe no-op.)
- `0086_newsletter_subscribers.sql` — newsletter ingest table (`newsletter_subscribers`) for the landing's "Stay in the loop" form. Pre-fix the landing posted to `/api/email-subscribe` — an endpoint the Worker never implemented; the form showed "Subscribed. Check your inbox" while no D1 row was created and no email was sent. The fix adds the Worker route handler [src/http/subscribeHttp.js](manicbot/src/http/subscribeHttp.js) (canonical path `/api/subscribe`, plus an alias `/api/email-subscribe` so the existing landing keeps working without redeploy) backed by [src/http/subscribeHttpLogic.js](manicbot/src/http/subscribeHttpLogic.js) for pure parse / lang-fold / source-allowlist. Idempotent on `email` via UNIQUE index + `INSERT OR IGNORE`; second submit is a silent no-op (no double row, no double welcome). On the NEW-row path the Worker fires a fire-and-forget POST to admin-app `POST /api/internal/newsletter-welcome` ([admin-app/src/app/api/internal/newsletter-welcome/route.ts](manicbot/admin-app/src/app/api/internal/newsletter-welcome/route.ts)) authenticated with `Authorization: Bearer <INTERNAL_API_TOKEN>` (new env var, Worker secret + Pages env). The admin-app route delegates the real auth + body validation to the pure [server/newsletter/processWelcomeRequest.ts](manicbot/admin-app/src/server/newsletter/processWelcomeRequest.ts) (constant-time Bearer compare, email regex, lang fallback to `en`), then calls `sendNewsletterWelcomeEmail` (Resend transport) and stamps `welcome_sent_at`. On any failure path (token unset, ADMIN_APP_URL unset, admin-app non-200, fetch throw) the Worker stamps `welcome_send_error` on the subscriber row but the public endpoint still returns 202 — UX never regresses on misconfig, and email-enumeration via "this email already subscribed" is impossible because dedup + new-row both 202. CORS is open (`Access-Control-Allow-Origin *`); IP-rate-limited 60/min via the same shared D1 limiter as `/api/track`. Tests: [test/subscribe-http.test.js](manicbot/test/subscribe-http.test.js) (24 cases — parse/validation, dedup, rate-limit, 4 welcome-dispatch error paths, happy path, lang fold); [admin-app/src/__tests__/newsletter-welcome-template.test.ts](manicbot/admin-app/src/__tests__/newsletter-welcome-template.test.ts) (7 cases — 4-lang render, heading/body/bullets/unsubscribe URL); [admin-app/src/__tests__/newsletter-welcome-route.test.ts](manicbot/admin-app/src/__tests__/newsletter-welcome-route.test.ts) (18 cases — Bearer extraction, missing/wrong/constant-time-mismatch auth, body validation, happy path, sender error stamps `welcome_send_error`). Explicit follow-ups out of scope: one-click unsubscribe flow (template currently links to a `?token=placeholder` stub), double-opt-in confirmation email, broadcast surface that reads from this table.
- `0076_platform_messenger.sql` — ManicBot ↔ tenant_owner DM channel + N:M broadcasts. Three additive tables (`platform_threads`, `platform_thread_messages`, `platform_broadcasts`); intentionally NOT extending the 0067 `threads` family because that one is `tenant_id NOT NULL` by design and weakening it would erode tenant isolation. `platform_threads` is a singleton per recipient (UNIQUE on `recipient_web_user_id`) so the owner sees ONE channel "ManicBot" no matter how many sysadmins write. Read state is two per-thread pointers (`recipient_last_read_at`, `platform_last_read_at`) — cheaper than per-message read_at. Broadcasts record once in `platform_broadcasts` with `audience_filter_json` (`{scope: 'all' | 'by_plan' | 'by_billing_status', ...}`); fan-out stamps the same `broadcast_id` on every emitted `platform_thread_messages` row so the sysadmin UI can aggregate read/reply rates later. New tRPC router `platformMessenger` (admin-app) with two role surfaces: owner-side (`getMyThread / markMyThreadRead / sendMyReply` — all scoped by `ctx.webUser.id`, IDOR impossible) and sysadmin-side (`listThreads / getThread / sendDirectMessage / markThreadReadAsPlatform / broadcast / previewAudience / listBroadcasts / unreadCount`). Owner replies fan out a `platform.reply` notification to EVERY system_admin via `notifyManyWebUsers`. Sysadmin direct/broadcast messages drop a `platform.message` notification (idempotent via the existing `(web_user_id, source_slug, source_id, kind)` partial UNIQUE on `user_notifications`). UI: `/messages` for sysadmin without preview swaps the "Мессенджер привязан к салону" placeholder for the full platform pane (thread list + selected thread + «+ Рассылка» button); for owners the regular tenant `/messages` gains a pinned "ManicBot" entry at the top of the thread list driven by `platformMessenger.getMyThread`. New components in `src/app/(dashboard)/messages/_components/`: `PlatformAdminPane.tsx`, `PlatformOwnerView.tsx`, `BroadcastComposer.tsx`. New `kindMeta` entry for `platform.` prefix uses the `Megaphone` icon (fuchsia accent). Test coverage: `src/__tests__/platform-messenger-router.test.ts` (22 cases: auth gating, tenant isolation, owner-side IDOR scoping, sysadmin happy path, broadcast empty-audience rejection, mark-read idempotency, listBroadcasts).
- `0074_master_telegram_pairing.sql` — unlocks "salon-employed master uses the salon's Telegram bot in master role". Adds `masters.telegram_chat_id INTEGER` (nullable) — the bridge from a web-created master's synthetic `chat_id` (≥10B) to their real Telegram account, without disturbing the (tenant_id, chat_id) primary key or any of the foreign-key fields on appointments / master_client_blocks / google_integrations / conversations that all reference `master_chat_id`. Partial UNIQUE `idx_masters_tenant_tg_chat ON masters(tenant_id, telegram_chat_id) WHERE telegram_chat_id IS NOT NULL` prevents accidental double-binding. Adds `master_pairing_codes` — single-use, 7-day-TTL deep-link tokens (SHA-256 hex stored as PK, raw leaves the server exactly once in the response). Worker `services/masterPairing.js` exposes `generatePairingToken / hashPairingToken / buildDeepLink / createPairingCode / tryConsumePairingCode / getActivePairingCode`; admin-app mirror at `~/server/api/masterPairing/tokenLogic.ts` keeps the hash function in lockstep. **Bot recognition is broadened**: `services/users.js getMaster()` matches EITHER `chat_id` OR `telegram_chat_id`, so paired synthetic masters land in `isMaster()` true → existing `showMasterPanel + CB.MST_*` callbacks light up unchanged. **Notification routing**: new `masterTelegramRecipient(master)` helper prefers `telegramChatId` over the primary `chatId` and rejects synthetic-only masters (they can't receive TG); 5 recipient-gathering sites updated (`notifications.js notifyAptStaff / notifyAptStaffAutoConfirmed / notifyStaffAptCancelled / notifyStaffConsultantRequest` + 3 sites in `handlers/message.js`). **Worker `/start mst_<rawToken>`** branch in `handlers/message.js` runs BEFORE the existing `decodeStartPayload` analytics path so pairing tokens never get misread as UTM payloads; cross-tenant guard inside `tryConsumePairingCode` rejects any code whose `tenant_id` doesn't match the bot's resolved `ctx.tenantId`. **tRPC surface**: `master.requestPairingCode / getMyPairingState / unpairTelegram` (master-role-only, IDOR-guarded via existing `assertCallerIsMaster`), `salon.createMasterPairingCode / setMasterTelegramChatId / listMasterPairingStates` (tenant-owner-only, owner can ALSO type a chat_id manually). **UI**: `~/components/master/MasterTelegramPairingCard.tsx` lives in the Master dashboard Profile tab (self-hides when the master's primary chat_id is already a real TG, so legacy `invited_telegram` masters aren't pestered); `~/components/salon/SalonMasterPairingTable.tsx` is wired inside the existing Telegram sub-tab of `SalonChannelsTab`. **Packaged as a marketplace plugin** (UI catalog facade, no router/lifecycle — same pattern as `google-calendar`): `plugins/master-telegram-pairing/manifest.ts`. Test coverage: Worker `test/master-pairing.test.js` (17 cases: pure helpers, mint, consume happy path, cross-tenant guard, expired / consumed / archived / gone rejections, partial-UNIQUE collision, `getActivePairingCode` semantics); admin-app `src/__tests__/master-telegram-pairing-router.test.ts` (20 cases: token-logic mirror, master/salon-side tRPC auth + happy paths + collision/precondition rejections). i18n keys `master_pairing_*` added to all 4 locales (ru/ua/en/pl).
- `0082_owner_telegram_pairing.sql` — symmetric to `0074_master_telegram_pairing.sql` but for the `tenant_owner` role. Adds `web_users.telegram_chat_id INTEGER` (nullable) + partial UNIQUE `idx_web_users_tg_chat` so the same Telegram chat_id cannot be bound to two web accounts. New table `owner_pairing_codes` keyed on `web_user_id` (instead of `master_chat_id`). Worker `src/services/ownerPairing.js` exposes the same surface as `masterPairing.js` (`generatePairingToken / hashPairingToken / buildDeepLink / createPairingCode / tryConsumePairingCode / getActivePairingCode`); admin-app mirror at `~/server/api/ownerPairing/tokenLogic.ts`. **On consume the Worker performs three writes in one `dbBatch`**: (1) `UPDATE web_users SET telegram_chat_id = <real_tg>`, (2) `INSERT OR REPLACE INTO tenant_roles (tenant_id, chat_id, role='tenant_owner')` so the existing `resolveRole` lookup recognizes the owner without any code change in `services/users.js`, (3) stamps the code consumed. **Worker `/start own_<rawToken>`** branch in `handlers/message.js` mirrors the `mst_` branch and runs BEFORE `decodeStartPayload` so the analytics tracker never sees pairing tokens. **tRPC surface**: `ownerPairing.requestPairingCode / getMyPairingState / unpair` (all `tenantOwnerProcedure` + `assertCallerOwnsTenant` — system_admin previewing a tenant is explicitly REJECTED so a sysadmin cannot bind their personal Telegram into a customer's salon). **UI**: `~/components/salon/SalonOwnerPairingCard.tsx` is mounted at the top of the Telegram sub-tab in `SalonChannelsTab` (above the existing `SalonMasterPairingTable`). Three-state design (paired / pending / CTA), same visual contract as `MasterTelegramPairingCard`. Test coverage: Worker `test/owner-pairing.test.js` (16 cases — pure helpers, mint, consume happy path, cross-tenant guard, expired / consumed / web_user_gone / web_user_tenant_changed / tg_chat_in_use rejections, partial-UNIQUE collision, `getActivePairingCode` semantics), `test/owner-pairing-integration.test.js` (4 cases — static pin on the `/start own_` wiring); admin-app `src/__tests__/owner-pairing-router.test.ts` (15 cases — token-logic mirror, sysadmin/master/cross-tenant rejections, happy path, unpair). i18n keys `owner_pairing_*` added to all 4 locales (ru/ua/en/pl). **Companion fix** in the same PR: `salon.updateSalonProfile` now mirrors `input.name` into `tenants.salon.name` JSON (it was only writing to the `tenants.name` column), and Worker `showAdminSettings` ([src/ui/admin.js](manicbot/src/ui/admin.js)) falls back to `ctx.tenant.name` so seed-tenants and any legacy row without a `salon.name` JSON value still render the right name in the bot's «⚙️ Salon Settings» panel. Pinned by `src/__tests__/salon-update-profile-name-mirror.test.ts` (4 cases) + `test/admin-settings-name-fallback.test.js` (5 cases).
- `0081_marketing_sends_complained.sql` — adds `marketing_sends.complained_at INTEGER` (nullable) to complete the delivery-lifecycle column set (`delivered_at` / `opened_at` / `clicked_at` / `bounced_at` were already present from `0032_marketing_schema.sql`). Distinct from `bounced_at` because the compliance / sender-reputation handling differs: a complaint is a reader-initiated "this is spam" signal, while a bounce is the provider rejecting delivery. Consumed by the **Resend webhook** at `~/app/api/resend/webhook/route.ts` (Svix-verified): the pure-function `processResendEvent` (`~/server/marketing/webhooks/processResendEvent.ts`, 13-case unit test in `marketing-webhook-resend.test.ts`) maps the event type → column patch; the route handler applies via `COALESCE` so retries can't clobber, plus a SQL `CASE`-monotonic status promotion (terminal `bounced` / `complained` / `failed` always beat positive states `opened` / `clicked`). New tRPC procedure `marketing.sendsRecent` (`adminProcedure`, cross-tenant) feeds the `/system/marketing/sends` deliverability dashboard with the joined campaign-name + tenant context. Brevo webhook ingestion is a follow-up — Brevo-routed sends stay at `queued / sent / failed` until that ships.
- `0083_blog_posts.sql` — self-hosted marketing blog CMS. Single table `blog_posts` (status `draft | published | archived`, slug globally UNIQUE, multilingual `titles_json / excerpts_json / bodies_json / cover_alt_json / keywords_json` keyed by `Lang`, optional `cover_url / cover_credit / related_slugs_json`). Was-static blog at `/blog` (the 10 hardcoded TS articles in [content/blog/posts/](manicbot/admin-app/src/content/blog/posts/)) moved to D1 so new posts no longer require a redeploy or an external CMS subscription. Admin surface at **`/system/blog`** (system_admin only, sidebar entry `god.blog` in the `platform` group): list with KPI tiles + status tabs + search + category filter + per-row publish/archive/delete actions; editor at `/system/blog/new` and `/system/blog/[id]` with 4-language tabs (ru/ua/en/pl), markdown body, slug auto-translit from title (Cyrillic + Polish diacritics), inline image insert at cursor, and cover-image upload. Both cover + inline images upload via the existing Worker `/upload/asset` pipeline with two NEW `ALLOWED_KINDS`: `blog_cover` and `blog_photo` (added in both [src/services/upload.js](manicbot/src/services/upload.js) and [admin-app/src/server/lib/uploadToken.ts](manicbot/admin-app/src/server/lib/uploadToken.ts)) — blog assets are platform-owned and use the `_platform` sentinel `tid` so R2 keys land at `t/_platform/blog_cover-{sha12}.{ext}`. tRPC `blogRouter`: admin procs `list / get / create / update / publish / unpublish / archive / unarchive / delete / mintUploadToken / seedDefaults / stats` (all `adminProcedure`) + public procs `listPublic / getPublic` (`publicProcedure`, filter `status='published'`). `delete` refuses `published` rows (must archive first); `publish` clears `archived_at`; `archive` preserves `published_at` for audit. Pure helpers in [admin-app/src/server/blog/serialize.ts](manicbot/admin-app/src/server/blog/serialize.ts): `slugify` (Cyrillic transliteration + NFKD ASCII fold + 100-char clamp), `validateSlug` (strict kebab-case), `coalesceLang` (documented fallback chain lang → en → ru → first non-empty), `parseBlogRow` / `serializeBlogInput` (DTO ↔ DB row, tolerant of malformed JSON blobs). Public `/blog` + `/blog/[slug]` pages refactored to call `api.blog.listPublic` / `api.blog.getPublic` server-side via `~/trpc/server`, with **fallback** to the legacy static `BLOG_ARTICLES` constant so the public site keeps rendering during the pre-seed window (admin clicks "Import default articles" once to move the 10 legacy posts into D1 — `seedDefaults` is idempotent via slug uniqueness). Conversion DB → static-shape via [admin-app/src/server/blog/dtoToArticle.ts](manicbot/admin-app/src/server/blog/dtoToArticle.ts) so `BlogClient` and `ArticleClient` renderers stay unchanged — they accept `articles` / `article + related` props instead of importing from the hardcoded module. Test coverage: [admin-app/src/__tests__/blog-serialize.test.ts](manicbot/admin-app/src/__tests__/blog-serialize.test.ts) (26 cases — slugify all 4 lang families, validateSlug edge cases, coalesceLang fallback chain, parseBlogRow malformed-JSON tolerance, serializeBlogInput lang-key pruning) + [admin-app/src/__tests__/blog-router.test.ts](manicbot/admin-app/src/__tests__/blog-router.test.ts) (23 cases — auth gating for every proc, slug uniqueness CONFLICT, status transitions, delete-published rejection, mintUploadToken kind allowlist, public reads bypass auth).
- `0089_webhook_dedup.sql` — atomic webhook idempotency store. Replaces the KV GET-then-PUT race in [src/utils/dedup.js](manicbot/src/utils/dedup.js) (Telegram/IG/WA claim helpers) with `INSERT INTO webhook_dedup (key, expires_at, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING` — a single SQLite statement that's strongly consistent (`meta.changes === 1` means this caller won the claim; `0` means a previous claim already exists). Closes the pre-launch concurrency hole where two retries of the same Meta webhook arriving milliseconds apart on different edge isolates would both read NULL from KV, both PUT, and both return `true` — yielding duplicate bookings / AI replies / analytics. **Backend is pluggable** via `env.WEBHOOK_DEDUP_BACKEND ∈ {"kv","d1","dual"}`. Default (when unset) is **`"dual"`** — D1 is the source of truth for the verdict, KV mirrored as audit so an emergency flip back to `"kv"` doesn't lose the live claim corpus. The API surface (`claimTelegramUpdate / claimMetaMessage / claimWAMessage / claimOnce`) is unchanged — webhook handlers in `src/http/telegramWebhookHttp.js` + `src/http/metaWebhooksHttp.js` keep their existing call sites. Cleanup: [src/worker.js](manicbot/src/worker.js) `scheduled()` calls `pruneExpiredDedupRows(env)` once per 15-min tick (`DELETE FROM webhook_dedup WHERE expires_at < ?`) so the table never grows unbounded; with TG TTL 5 min + Meta TTL 24h the live working set sits well below 10k rows. Test coverage: [test/dedup-d1-backend.test.js](manicbot/test/dedup-d1-backend.test.js) (14 cases — sequential contract, 50-way `Promise.all` concurrency proving exactly one true wins, backend selection matrix, graceful degradation when D1 binding is missing). The existing 17 KV-era tests in `dedup-race-window.test.js` + `wa-webhook-dedup.test.js` keep passing.
- `0088_d1_backup_log.sql` — platform-level D1 → R2 backup audit log. Powers the automatic backup pipeline introduced as Blocker 1 of the pre-launch remediation sprint. Single table `d1_backup_log(id, started_at, finished_at, bucket_key, kind ∈ {daily, weekly}, table_count, row_count, byte_size, sha256, status ∈ {success, partial, failed}, error_message)`. Indexes: `(finished_at DESC)` for the dashboard tail + `(kind, status, finished_at DESC)` for the "latest successful daily" idempotency lookup. Cron runs in [src/worker.js](manicbot/src/worker.js) `scheduled()` via `maybeRunD1Backup(env)` ([src/services/d1Backup.js](manicbot/src/services/d1Backup.js)) — called once per 15-min tick, with a 6h idempotency window keyed off the most-recent `status='success'` row. R2 binding: the existing `ARCHIVE` bucket (`manicbot-archive`); keys land under `backups/daily/<ISO>.ndjson.gz` (kept 30 days) and `backups/weekly/<year-Wweek>.ndjson.gz` (kept 365 days, promoted from the first daily of each ISO week). Backup payload format: gzipped NDJSON, header line `{kind:"manicbot-d1-backup", version:1, tables:[...], row_count_by_table:{...}}` + one `{t:"<table>", r:<row>}` line per data row. Restore via `node scripts/restore-d1.mjs --latest` (or `--key <r2-path>` / `--list` / `--dry-run` / `--local`) — uses `wrangler d1 execute --file` under the hood, applies `INSERT OR REPLACE` per row in batches of 500, never deletes rows that exist locally but not in the backup. Operator runbook: [docs/runbooks/d1-restore.md](manicbot/docs/runbooks/d1-restore.md) (Russian, no-jargon). Test coverage: [test/d1-backup.test.js](manicbot/test/d1-backup.test.js) (17 cases — `listSqliteTables` filter, dump round-trip preserves every row across all tables, restore rejects unrecognized headers + truncated dumps, daily/weekly key builders, `isWeeklySnapshotDue` semantics, full `runBackup` flow on fake D1+R2, 6h idempotency window with prior success / 7h-stale / fresh / failure-only history, pruning daily >30d + weekly >365d).
- `0077_service_categories.sql` — service categories as a first-class entity ("lists of services", PR-1 of the categories+packages plan). New table `service_categories(tenant_id, id, name, sort_order, created_at)` with UNIQUE on `(tenant_id, name)` and an index on `(tenant_id, sort_order)`. The existing `services.category TEXT` column (added in 0029) stays as the denormalized assignment — keeps Worker hot-path reads simple (no JOIN in the booking-keyboard path) and lets rename/delete be atomic D1 batches (UPDATE services first, then UPDATE/DELETE `service_categories`). Migration backfills `service_categories` from every distinct existing `services.category` value, alphabetical-rank sort_order, so the deploy is zero visual change. New tRPC procs in `salon.ts`: `serviceCategoriesList` (returns `[{id, name, sortOrder, usageCount}]`), `createServiceCategory` (CONFLICT on duplicate, appends at end of sort order), `renameServiceCategory` (services first → catalog last so a mid-flight failure can't orphan service rows), `deleteServiceCategory(reassignToId?)` (services to new name or NULL, then DELETE), `reorderServiceCategories(ids[])` (cross-tenant defense: rejects unknown ids). New `ServiceCategoriesModal` ([src/components/salon/tabs/services/ServiceCategoriesModal.tsx](manicbot/admin-app/src/components/salon/tabs/services/ServiceCategoriesModal.tsx)) opened from a «Категории» button in the Services tab header. Modal supports add/inline-rename/up-down reorder/delete-with-reassign (nested confirm at z-[110]). ServiceModal's free-text «Категория» Input is replaced with the brand-styled `<Select>` sourced from `serviceCategoriesList` + an inline «+ Новая категория…» item that opens a window.prompt → `createServiceCategory`. Grouped rendering in SalonDashboard.tsx now sorts by `serviceCategoriesList[].sortOrder` (was alphabetical). Public `/salon/{slug}` page (`SalonProfileClient`) renders services grouped by category in the same order. Worker side: **fixes a data-loss bug** — `src/services/services.js` previously ignored `services.category` entirely (`svcRowToDoc` didn't map it, `saveServiceRow` didn't bind it). Because `saveServices` does `DELETE * + per-row INSERT`, any Telegram-side service edit silently nulled every category the owner set on the web. Pinned by `test/services-category-roundtrip.test.js` (4 cases). New helper `loadServiceCategories(ctx)` populates `ctx.svcCategories` during `initServices` (same 60s in-memory cache as services). `svcKb` (booking-flow keyboard) groups services under category headers (`— Маникюр —` no-op separator rows since Telegram inline keyboards have no native header concept); IG paging stays flat to preserve the 12-row budget. Falls back to legacy flat list when there are no categories or no service is assigned. Pinned by `test/svc-kb-categories.test.js` (7 cases). admin-app tests: `src/__tests__/service-categories-router.test.ts` (16 cases — CRUD, duplicate CONFLICT, rename collision, reassign-into-self BAD_REQUEST, reorder cross-tenant defense). Tenant-isolation allowlist line bumped 1483 → 1685 (the cross-tenant bot_id collision check shifted after this PR's ~200 lines of new procs in salon.ts). Personal-master mirror (`masterRouter.createServiceCategory` etc.) intentionally not in this PR — keeps the diff small; they can still edit `category` on their own services via the existing `master.updateService` proc. PR-2 (service packages) lands separately and stacks on this entity.

## Marketing automation triggers (PR 2C, 2026-05-17)

**Event-driven marketing automations now actually fire** — previously the seam in `src/services/appointmentAutomations.js` only COUNTED matching `marketing_automations` rows; it never executed them. Phase 2C closes that loop:

- **Single-recipient mode on the Worker sender.** `runCampaignSend(ctx, tenantId, campaignId, { singleContactId })` ([src/services/marketing/sender.js](manicbot/src/services/marketing/sender.js)) bypasses `resolveAudience` and sends to exactly one `marketing_contacts` row when `singleContactId` is provided. The same consent gates (`unsubscribed = 0`, `consent_email = 1` or `consent_sms = 1`, non-empty recipient column) are applied — a wrong-tenant id or an unsubscribed contact is a silent no-op.
- **New dispatcher: `fireAutomationForEvent`** ([src/services/marketing/automations.js](manicbot/src/services/marketing/automations.js)). SELECTs enabled `marketing_automations` whose `trigger_type` matches the event AND `tenant_id` matches (or is NULL for platform defaults). For each row, looks up the triggering user's `marketing_contacts` row via `linked_user_chat_id`. If found, creates an ad-hoc campaign and calls `runCampaignSend(..., { singleContactId })`. If no `marketing_contact` exists for the user (no consent path), the automation is a silent no-op — automations don't create contacts on the fly (that's admin-app `syncMarketingContact`'s job).
- **`steps_json` shape**: array; first element is the "send step" with `{ templateId, channel?, segmentId? }`. Worker-side `parseFirstSendStep` ([src/services/marketing/automations.js](manicbot/src/services/marketing/automations.js)) is the canonical parser — admin-app `automationRunNow` follows the same convention.
- **Wired event sources (this PR)**: `appointment.done`, `appointment.no_show_master`, `appointment.no_show_client`, `appointment.confirmed`, `appointment.rejected`, `appointment.cancelled`, `appointment.rescheduled` — all via the existing `dispatchAppointmentAutomation` ([src/services/appointmentAutomations.js](manicbot/src/services/appointmentAutomations.js)). The count-only loop at step "2. Marketing-automations lookup" became a real dispatch into `fireAutomationForEvent`; the `automationsFired` field on the dispatcher result now means "automations that generated at least one send" (was previously "automations that matched the SELECT").
- **Pending wires (follow-up)**: `birthday` (Worker `processBirthdayAndReturningPromos` cron), `registered` (admin-app `webUsers.register`), `inactive_30d` (new cron). Each adds one call site; the dispatcher infrastructure is already there.
- **Idempotency**: `dispatchAppointmentAutomation` is called once per status flip on an apt (the upstream Worker handler de-dupes via the action-button flow). Ad-hoc campaign ids are unique per call (`cmp_auto_<random><ts>`), so retries create distinct rows in `marketing_campaigns` rather than colliding.
- **Tests**: `test/marketing-automations-dispatcher.test.js` (16 cases — happy path, platform defaults, no-contact skip, invalid steps, missing tenantId/chatId, etc.). The existing `test/appointment-automations-dispatcher.test.js` (6 cases) was updated to reflect the new semantics of `automationsFired`.

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

### Meta OAuth — in-product Instagram connect

The salon owner no longer pastes a Page Access Token. The Channels → Instagram tab presents two buttons (Instagram Login + Facebook Login for Business) that drive an end-to-end OAuth flow. Manual paste is preserved as a collapsed «Расширенный режим» escape hatch.

- **Pure helpers**: [src/services/meta-oauth-logic.js](manicbot/src/services/meta-oauth-logic.js) — token-prefix detection (`IGAA` → `instagram_direct`, `EAA` → `facebook`), CSPRNG 64-char hex state, PKCE S256 challenge, `buildMetaAuthUrl`, `parseMetaCallbackQuery`, `canAutoFinalizeDraft`. 45-case unit test pin in [test/meta-oauth-logic.test.js](manicbot/test/meta-oauth-logic.test.js).
- **Handlers + state KV**: [src/services/meta-oauth.js](manicbot/src/services/meta-oauth.js) — KV-backed state (`meta:oauth:state:{state}`, 15-min TTL, single-use) and draft (`meta:oauth:draft:{state}`, also 15-min TTL, single-use post-finalize). Code exchange runs against `api.instagram.com` (IG) or `graph.facebook.com` (FB) plus `/me` + `/me/accounts` derivation. IDOR guard: `tenantId` + `webUserId` bound at start, re-checked on every consume / finalize so a leaked state can't be reused by another tenant_owner. Auto-subscribes the corresponding webhook (`/{ig_user_id}/subscribed_apps` for IG-direct or `/{page_id}/subscribed_apps` for FB-Page). 24 integration tests in [test/meta-oauth-handlers.test.js](manicbot/test/meta-oauth-handlers.test.js).
- **HTTP routes**: [src/http/metaOAuthHttp.js](manicbot/src/http/metaOAuthHttp.js) — `POST /meta/oauth/start` (admin-keyed, mints state), `GET /meta/{instagram|facebook}/callback` (Meta-initiated, exchanges code, redirects back to admin-app with `?meta_state=…&meta_ok=…`), `POST /meta/oauth/consume` (admin-keyed; auto-finalize OR returns Page picker payload with PAGE TOKENS STRIPPED), `POST /meta/oauth/finalize` (admin-keyed; binds chosen Page after picker). Wired in [src/worker.js](manicbot/src/worker.js) between `tryGoogle` and `tryMetaWebhooks`.
- **tRPC gateway**: [admin-app/src/server/api/routers/metaOAuth.ts](manicbot/admin-app/src/server/api/routers/metaOAuth.ts) — `start / consume / finalize`. Every procedure is `protectedProcedure + assertTenantOwner`; the `start` proc also locks `returnTo` to the AUTH_URL origin (defense-in-depth open-redirect guard).
- **UI**: [admin-app/src/components/salon/InstagramConnect.tsx](manicbot/admin-app/src/components/salon/InstagramConnect.tsx) — two OAuth buttons (Instagram primary with «Рекомендуем» badge, Facebook secondary), inline status surface (`opening / completing / success / error`), Page picker modal for FB multi-page tenants, collapsed manual-paste escape hatch. Mounts a `useSearchParams` hook that picks up the `?meta_state=…&meta_ok=…` redirect-back, calls `consume`, and clears the URL params via `router.replace`. 10 RTL tests in [admin-app/src/__tests__/InstagramConnect.test.tsx](manicbot/admin-app/src/__tests__/InstagramConnect.test.tsx).
- **Required env**: Worker needs `META_APP_ID` (FB Login, already in `[vars]`) + `META_APP_SECRET` + `META_INSTAGRAM_APP_ID` + `META_INSTAGRAM_APP_SECRET` (the IG product secret was added 2026-05-14 during the IG silent-drop recovery). `/meta/oauth/start` returns 503 (`oauth_not_configured`) when the matching pair for the chosen provider is unset, so the UI hides the button conditionally rather than 500ing.

### Channel lifecycle (PR 2 — 2026-05-18)

The salon owner now has full lifecycle control without an admin round-trip for every action:

- **Test-message diagnostic**: [src/http/adminKeyHttp.js](manicbot/src/http/adminKeyHttp.js) `POST /admin/ig-send-test` (Bearer ADMIN_KEY). Decrypts the tenant's IG token, builds an `InstagramAdapter`, and sends a one-off DM to the supplied PSID. The Worker deliberately drops the local 24h-window guard so the operator sees Meta's own verdict (`outside_message_window` etc.) — invaluable for confirming the channel is wired. tRPC wrapper `salon.sendInstagramTestMessage` is `tenantOwnerProcedure + assertTenantOwner`. UI in [admin-app/src/components/salon/IGSendTestDialog.tsx](manicbot/admin-app/src/components/salon/IGSendTestDialog.tsx) (PSID + optional text + Send → success / verbatim Meta error). 8 Worker tests in [test/admin-ig-send-test.test.js](manicbot/test/admin-ig-send-test.test.js) + 5 router tests.
- **Soft vs hard disconnect**: `salon.disconnectChannel` now takes a `mode` enum, default `'soft'` (sets `active=0`, KEEPS the encrypted token → can be resumed with one click). `'hard'` keeps the existing semantic — DELETE the row, requires fresh OAuth to reconnect. New `salon.reactivateChannel` flips `active=1`. UI in [admin-app/src/components/salon/SalonChannelsTab.tsx](manicbot/admin-app/src/components/salon/SalonChannelsTab.tsx) `PauseRemoveActions` — two-button row (Pause / Remove for active channels, Resume / Remove for paused), red-confirm modal on Remove.
- **Re-auth CTA**: [admin-app/src/components/salon/IGHealthCard.tsx](manicbot/admin-app/src/components/salon/IGHealthCard.tsx) accepts an `onRequestReauth?` prop. When set AND the channel state is `broken` / `needs_attention`, the card surfaces a pink "Переподключить" button → red-confirm modal → hard-disconnect → channel list refetches → the parent unmounts the connected card and remounts `InstagramConnect`, which shows the OAuth buttons. No new tRPC surface — re-uses `disconnectChannel(mode='hard')` + the PR 1 OAuth flow.

### Structured channel error_type slugs (PR 3 — 2026-05-18)

Before PR 3, the IGHealthCard matched open errors with `LIKE %instagram%` substring search on the raw `error_events.message` column — anything not in the hardcoded keyword whitelist was invisible, and translations into ru/ua/pl were impossible because the surface displayed the raw English message. PR 3 replaces this with structured slugs:

- **Slug catalog**: [src/channels/error-types.js](manicbot/src/channels/error-types.js) (Worker) and [admin-app/src/server/api/channelErrorTypes.ts](manicbot/admin-app/src/server/api/channelErrorTypes.ts) (mirror). Seven IG-related slugs split into "broken" (`channel.ig.token_decrypt_failed`, `channel.ig.token_rejected`, `channel.ig.needs_reauth`) vs "degraded" (`channel.ig.subscription_lost`, `channel.ig.resubscribe_failed`, `channel.meta.signature_mismatch`, `channel.ig.health_probe_failed`). Parity locked by [src/__tests__/channel-error-types-parity.test.ts](manicbot/admin-app/src/__tests__/channel-error-types-parity.test.ts) (6 cases — keys + values + ordering + i18n coverage).
- **captureError contract**: [src/utils/errorCapture.js](manicbot/src/utils/errorCapture.js) now accepts `context.errorType` (slug, ≤64 chars). Falls back to `Error.name` for callers that don't supply one. Wired at four sites in PR 3:
  - [src/handlers/cron.js](manicbot/src/handlers/cron.js) `phaseChannelHealth` — stamps `IG_TOKEN_DECRYPT` / `IG_TOKEN_REJECTED` / `IG_SUBSCRIPTION_LOST`.
  - [src/handlers/cron.js](manicbot/src/handlers/cron.js) `maybeResubscribeIgWebhook` — stamps `IG_RESUBSCRIBE_FAILED` on non-200 from Graph.
  - [src/http/metaWebhooksHttp.js](manicbot/src/http/metaWebhooksHttp.js) — stamps `META_WEBHOOK_SIGNATURE_MISMATCH` on the signature-fallback failure path.
  - [src/channels/instagram.js](manicbot/src/channels/instagram.js) `send()` — stamps `IG_INTEGRATION_NEEDS_REAUTH` when a Graph send returns `tokenDead`.
- **Router**: `salon.getInstagramHealth` ([admin-app/src/server/api/routers/salon.ts](manicbot/admin-app/src/server/api/routers/salon.ts)) now queries `error_events.errorType IN (…IG_ALL_ERROR_TYPES…)` (Drizzle `inArray`) instead of substring-matching the message. State machine refined: a `broken`-bucket slug forces state=`broken`; a `degraded` slug holds at state=`warning`; legacy English-only messages (no slug) are no longer rendered (pre-PR-3 rows were already pinged by ops by now).
- **i18n**: 8 new keys (`channels.ig.errorType.*`) localized to ru/ua/en/pl. `IGHealthCard.translateChannelErrorSlug` maps slug → localized message; raw message stays in the `title` attribute so support can still grab it for escalation. Slug shown verbatim below the localized line as `code` for debuggability.
- **Tests**: 5 Worker tests in [test/error-capture-error-type.test.js](manicbot/test/error-capture-error-type.test.js) pin the `errorType` field shape + length cap + slug catalog. 6 admin-app parity tests. Worker suite 2398/2398.

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

Seed catalog (post 2026-05-16 Phase 1 cleanup + first Variant A wave + GCal restore): **12 first-party plugins** — 7 retained from the cleanup (loyalty-stamps, shift-planner, task-board, availability-share, earnings-goal, export-hub, message-templates), the restored **google-calendar** (manifest-only marketplace facade over the core OAuth flow — `googleCalendar.ts` router + `GoogleCalendarRuntime.tsx` were never removed during the cleanup, only the manifest was), two Variant A plugins: **review-collector** (free, post-visit 4★/5★ Google/Yandex CTA wired into [src/handlers/callback.js](manicbot/src/handlers/callback.js) via [src/plugins/reviewCollectorCta.js](manicbot/src/plugins/reviewCollectorCta.js)) and **inventory-lite** (free, JSON-backed inventory with low-stock highlighting, no D1 migration — fits ~80 items inside the 8 KB settings_json cap), plus two later additions documented separately in the migration list above: **reminders** (cron-backed, see migration 0070) and **master-telegram-pairing** (UI facade over the core pairing flow, see migration 0074). 12 prior slugs were either duplicates of already-shipped core features (`booking-reminder`, `client-crm-lite`, `quick-notes`) or had their UI folded back into core (`ai-abuse-monitor`, `gdpr-center`, `sla-tracker`, `escalation-playbook`, `kb-search`, `ticket-templates`, `keyboard-shortcuts`, `dark-plus`, `portfolio-gallery`). The fold-into-core work itself ships in a follow-up PR — see [manicbot/plugins/registry.ts](manicbot/plugins/registry.ts) header + [manicbot/admin-app/src/__tests__/plugins-removed-duplicates.test.ts](manicbot/admin-app/src/__tests__/plugins-removed-duplicates.test.ts) for the full removed-slug list and rationale.

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

## Internal Messenger — staff visibility + master placeholders (2026-05-26)

Owner-side `/messages` "+ Новый чат" picker now reflects the **full salon team**, not just web-account-linked masters. Before the fix, `messenger.listStaff` JOINed only on `web_users.tenant_id = salon`, which silently dropped every master whose `web_users.tenant_id` points at their personal tenant (the canonical state right after `acceptInvitationExistingUser` — that flow inserts `masters` + `tenant_roles` rows for the salon but never mutates `web_users.tenant_id`). Telegram-paired masters with no web account at all (origin=`invited_telegram`) were also invisible. The owner saw an empty picker even when the team WAS there.

**`messenger.listStaff`** ([src/server/api/routers/messenger.ts](manicbot/admin-app/src/server/api/routers/messenger.ts)) — source of truth is now `masters` + `tenant_owner` row from `web_users`. Four-SELECT shape locked by [src/__tests__/messenger-list-staff.test.ts](manicbot/admin-app/src/__tests__/messenger-list-staff.test.ts) (8 cases). Candidates carry `{refKind: 'web_user' | 'master', masterChatId?, canDm, connectStatus}` so the UI can render "Подключён / Только Telegram" chips.

**`messenger.createStaffDm`** — two input branches, exactly one required: `{otherWebUserId}` (real DM) or `{otherMasterChatId}` (placeholder thread for masters without a web account). Cross-tenant guard relaxed: a web_user whose `web_users.tenant_id` differs from the salon is accepted iff there's an active `masters.web_user_id` row linking them in this salon. dm_key for placeholder uses the `m:<chatId>` sentinel sorted against the caller's UUID so it can't collide with real web_user dm_keys. Pinned by [src/__tests__/messenger-create-staff-dm-master.test.ts](manicbot/admin-app/src/__tests__/messenger-create-staff-dm-master.test.ts) (9 cases).

**Backfill** — [src/server/messenger/linkMasterPlaceholder.ts](manicbot/admin-app/src/server/messenger/linkMasterPlaceholder.ts) `linkMasterPlaceholderToWebUserFireAndForget`. Called from `webUsers.acceptInvitationExistingUser` + `acceptInvitationByToken` (fire-and-forget; never aborts the accept flow). Flips `thread_members.member_kind` master→web_user, recomputes `dm_key`, and on dm_key UNIQUE collision merges the placeholder thread into the surviving real DM (re-parents messages, deletes placeholder). Pinned by [src/__tests__/messenger-link-master-placeholder.test.ts](manicbot/admin-app/src/__tests__/messenger-link-master-placeholder.test.ts) (3 cases).

**UI** — [src/app/(dashboard)/messages/_components/NewThreadModal.tsx](manicbot/admin-app/src/app/(dashboard)/messages/_components/NewThreadModal.tsx) — DM picker now splits candidates into two groups: DM-able masters first, then a "Без веб-аккаунта" subsection with `Telegram-only` chips. Clicking a placeholder opens a thread immediately; messages stay on `thread_messages` and become visible to the master the moment they link a web account. Group-chat creation only accepts DM-able rows (a group needs every member reachable in-app); placeholder masters get a hint line below the picker.

**Known gap** (follow-up PR): Telegram delivery for placeholder threads — when the owner posts in a placeholder thread, the message persists in D1 but the master gets no live Telegram nudge until they open web. The hook lives in the Worker `sendMessage` relay; the wiring (read `masters.telegram_chat_id || chat_id`, push via the Telegram adapter) is sketched in TaskList #8 of [memory](#) and intentionally out of scope here to keep the PR boundary clean.

## Notification Center

Platform-wide in-app feed driving the header bell + a full-history view at `/notifications`. Every salon owner / master / support agent sees the same bell with their own row set; `user_notifications` rows are scoped by `web_user_id` and every read/mutation is pinned to the caller via `notificationsRouter` (no cross-user reads possible).

**Surfaces:**
- `components/layout/NotificationBell.tsx` — bell with unread badge + 10-row dropdown (refetch 30s closed, 5s open). Mounted in BOTH `Shell.tsx` (Telegram Mini App) and `WebShell.tsx` (web dashboard, between the tour-replay button and the theme toggle). PR1 (2026-05-17) added the WebShell mount — previously the web dashboard had no bell at all and salon owners using https://manicbot.com missed every in-app notification. Pinned by `src/__tests__/webshell-bell-mount.test.ts`.
- `app/(dashboard)/notifications/NotificationsClient.tsx` — `/notifications` full-history page. Per-`kind` icon + accent, relative time, "Сегодня / На этой неделе / Ранее" buckets, "Все / Непрочитанные" tabs, per-row dismiss (hard-delete via `notifications.dismiss`).

**Writers** (the bell stays empty until someone calls `notifyWebUser`):
- `server/services/notifyWebUser.ts` — admin-app-side Drizzle helper. Mirror of the Worker `src/services/userNotify.js`. INSERT OR IGNORE on the `(web_user_id, source_slug, source_id, kind)` partial UNIQUE → caller-controlled `sourceId` decides collapse semantics. Exports `notifyWebUser` and a `notifyManyWebUsers` fan-out. Pinned by `src/__tests__/notify-web-user.test.ts`.
- `plugins/reminders/cron.js` — fires `kind='reminder.fired'` per reminder occurrence (pre-existing).
- `server/api/routers/support.ts` — three new writers added in PR1:
  - `replyToTicket` → in-app `support.reply` to the ticket owner (resolved via `platform_tickets.client_name` email → `web_users`). Title localized to ru/ua/en/pl per `web_users.lang`. Link: `/settings?section=help&ticket={id}` — `HelpSection` auto-opens that ticket via `useSearchParams`.
  - `createTicket` → fan-out `support.ticket.new` to every `web_users.role IN (system_admin, support, technical_support)`, minus the creator.
  - `replyToMyTicket` → fan-out `support.ticket.reply` to support staff (client-side follow-up). `sourceId` includes the message timestamp so multiple replies don't collapse.

  All three are fire-and-forget — a notification-write failure never blocks the underlying support mutation. Pinned by `src/__tests__/support-notifications.test.ts`.

- `server/api/routers/salon.ts` `sendMasterInvitation` (existing_user scenario) + `server/auth/backfillPendingInvites.ts` (called from `auth.getMyRole` as fire-and-forget). Both write `kind='master.invite'`, `sourceSlug='master_invitations'`, `sourceId=invitationId` with link `/invitations/{id}`. The send-time write is primary; the backfill is the safety floor — it recovers any pending invitation whose original notify insert was lost (PR-#151 pre-deploy invites, Resend hiccup, request abort mid-mutation). Idempotent via the partial UNIQUE on `(web_user_id, source_slug, source_id, kind)`. Pinned by `src/__tests__/auth-backfill-invites.test.ts` + `src/__tests__/salon-invite-flow.test.ts`.

**Smart Notification Center 2.0 — PR-A (Blocker fix: invite-loop visibility, 2026-05-26):** prior to PR-A, the invite email send was fire-and-forget — `void sendMasterInvite*Email(...).catch(log.error)`. When `RESEND_API_KEY` or `RESEND_FROM` env vars weren't set on Pages, `sendResendEmail` returned `{ok: false, error: "resend_not_configured"}` and the warning landed silently in Cloudflare logs while the salon owner saw a misleading green "Sent" toast. **PR-A makes the failure visible at three layers**:
  1. **Mutation return shape** now carries `{invitationId, scenario, emailQueued: boolean, transportError?: string}`. The mutation awaits the email send instead of fire-and-forgetting; the in-app bell row still lands for `existing_user` regardless of email outcome (the two paths are independent).
  2. **`InviteByEmailModal` UI** renders a yellow chip ("Приглашение создано, но email отправить не удалось — проверь /errors") when `emailQueued: false` instead of the green success toast. Localized in ru / ua / en / pl. The raw transport error code (e.g. `resend_not_configured`, `resend_http_500`) is shown as monospace muted text below the warning for operator triage.
  3. **`error_events` write** via the new admin-app `captureError` helper at [server/utils/captureError.ts](manicbot/admin-app/src/server/utils/captureError.ts) — Drizzle-based mirror of the Worker `manicbot/src/utils/errorCapture.js` (same FNV-1a fingerprint algorithm, same status-aware regression flip, same one-row-per-(fingerprint, tenant_id) contract). `errorType='email.transport_failed'`, `source='admin-app'`, `severity='error'`, context includes `{recipient, scenario, reason, invitationId}`. Surfaces in God Mode `/errors` dashboard alongside Worker captures. Best-effort: a D1 write failure here is logged and swallowed so it can never break the primary mutation.

  **Operator self-test**: `system.testResendTransport` adminProcedure (mutation) at [server/api/routers/system.ts](manicbot/admin-app/src/server/api/routers/system.ts) + a "Send myself a test" button in the env-vars card of `/system` ([SystemPageClient.tsx](manicbot/admin-app/src/app/(dashboard)/system/SystemPageClient.tsx)). Three return shapes: `{ok: true, configured: true}` (transport healthy), `{ok: false, configured: false, error: "resend_not_configured"}` (env vars missing → operator action: set `RESEND_API_KEY` / `RESEND_FROM` in Cloudflare Pages → Settings → Environment variables, redeploy), `{ok: false, configured: true, error: <api-error>}` (Resend rejected the call — bad key, unverified domain, sender mismatch, rate limit). Sender address is `ctx.webUser.email`; rejects if absent (`PRECONDITION_FAILED no_sysadmin_email_on_record`). Localized button copy via `gmSystem.resendTest.*` i18n keys (ru/ua/en/pl).

  **Tests**: [src/__tests__/salon-invite-flow.test.ts](manicbot/admin-app/src/__tests__/salon-invite-flow.test.ts) (+5 cases: happy `emailQueued: true` for both scenarios, `emailQueued: false` + `captureError` called on each transport failure path, captureError throwing does NOT break the mutation), [src/__tests__/captureError.test.ts](manicbot/admin-app/src/__tests__/captureError.test.ts) (+9 cases: fingerprint determinism, never-throws contract), [src/__tests__/system-router.test.ts](manicbot/admin-app/src/__tests__/system-router.test.ts) (+3 cases for `testResendTransport` role gating + precondition).

  **Operator action** (required before PR-A is end-to-end effective): set `RESEND_API_KEY` and `RESEND_FROM` (e.g. `ManicBot <noreply@manicbot.com>`) in Cloudflare Pages → manicbot-admin-app → Settings → Environment variables (Production scope), then redeploy. Verify by clicking "Send myself a test" in `/system` — expected `✅ Delivered to <sysadmin email>`.

**Smart Notification Center 2.0 — PR-B (event coverage gaps, 2026-05-26):** the bell taxonomy had blind spots — IM messages between staff, billing card declines, IG/WA channel outages all lit up `error_events` but never put a row in front of the salon owner. PR-B closes the five biggest gaps with new writers and two new categories.

  **New writers:**
  - **`messenger.message`** — [server/api/routers/messenger.ts](manicbot/admin-app/src/server/api/routers/messenger.ts) `sendMessage`. After each `thread_messages` INSERT, fans out one bell row per `thread_members` row where `memberKind='web_user' AND memberRef !== sender`. `sourceId='${threadId}:${messageId}'` so every post is a distinct bell entry (PR-C smart grouping collapses them visually). Sidecar try/catch — a D1 hiccup on the fan-out never breaks the primary mutation.
  - **`channel.broken`** / **`channel.degraded`** — Worker [src/handlers/cron.js](manicbot/src/handlers/cron.js) `phaseChannelHealth`. In parallel with the existing `error_events` writes that go to `/errors`, drops a bell row at the tenant owner so they see "Instagram канал не работает / Переподключить" without waiting for a sysadmin to forward the alert. `sourceId='instagram:<failure_slug>:<YYYY-MM-DD>'` so the same outage collapses to one row per day; a new day's outage gets a fresh row.
  - **`billing.payment_failed`** — Worker [src/billing/webhooks.js](manicbot/src/billing/webhooks.js) on `invoice.payment_failed`. Bell row links to `/settings?section=billing`. `sourceId='payment_failed:${invoiceId}'` so Stripe's retry/dunning cycle collapses to one row per failed invoice cycle.
  - **`billing.trial_expiring_soon`** — same file on `customer.subscription.trial_will_end` (Stripe fires T-3d by default). Dedup'd by subscription id.

  **Helper:** Worker `notifyTenantOwner(ctx, opts)` + `getTenantOwnerWebUserId(ctx)` added to [src/services/userNotify.js](manicbot/src/services/userNotify.js). Three call sites use it (cron channel-health, two billing webhook branches). One-shot helper avoids duplicating the `web_users WHERE tenant_id=? AND role='tenant_owner'` lookup at every caller. Returns `{ok: false}` silently when no owner row exists (orphan tenant / platform-scoped call) — never throws.

  **New categories:** `channel` (urgent operator-action, in-app + push default ON — last IG outage took 6 weeks to detect) and `client` (informational, in-app ON / push OFF). Added to `NOTIFICATION_CATEGORIES` + `DEFAULT_PREFS` in both [admin-app/src/lib/notifications/prefs.ts](manicbot/admin-app/src/lib/notifications/prefs.ts) AND the Worker mirror [src/services/notificationPrefs.js](manicbot/src/services/notificationPrefs.js) — the parity-fixture test enforces lockstep. `kindMeta.ts` gets `channel.` → `AlertTriangle` rose-500 accent and `client.` → `Users` teal-500 accent. `NotificationsSection.tsx` UI auto-picks up the new categories via the `NOTIFICATION_CATEGORIES.map()` loop; i18n keys `notifications.cat.channel{,.desc}` + `notifications.cat.client{,.desc}` added in all 4 langs.

  **Tests:** Worker [test/notify-tenant-owner.test.js](manicbot/test/notify-tenant-owner.test.js) (+8 cases: owner lookup happy path / no-owner / missing tenantId / missing db / non-owner role filtering; notifyTenantOwner happy / no-owner silent fail / idempotency on the partial UNIQUE). Admin-app [src/__tests__/messenger-router.test.ts](manicbot/admin-app/src/__tests__/messenger-router.test.ts) (+2 cases: bell fan-out to other web_user member, no-op when sender is the only web_user member). Worker suite 2652/2652, admin-app 4922/4922, check-schema 91/91, typecheck clean.

  **Not yet wired (deferred):** `client.new` (touches a hot-path INSERT in `services/users.js` — lands in PR-C with the avatar work), `plugin.addon_payment_failed` (low traffic pre-launch, lands with PR-C inline-action wave), `billing.grace_started` / `billing.subscription_renewed` (small wins, low priority).

**Smart Notification Center 2.0 — PR-C (smart grouping, 2026-05-26):** the bell + `/notifications` full-history feed used to scroll past 5 separate "Anna sent a message" rows when a single thread got busy. PR-C collapses bursts of same-kind activity into a single VK/FB-style "+N" row, keeping the most-recent post as the visible representative.

  **Pure helper:** [src/lib/notifications/grouping.ts](manicbot/admin-app/src/lib/notifications/grouping.ts) `groupNotifications(rows, options?)` — no React, no fetch, side-effect-free. Collapses ≥3 consecutive rows sharing the same `(kind, sourceSlug)` falling within a 2-hour window (configurable via `groupMin` / `windowSec` opts). Group key is `(kind, sourceSlug)` — null and undefined sourceSlug treated as the same bucket. A row of a different kind in the middle breaks the burst, so the feed honours genuinely interleaved activity rather than blindly clustering. Input is expected newest-first (matches `notifications.list` ORDER BY createdAt DESC); the representative is always the newest of the burst — that's the row whose body / link / avatar the user most likely wants to see first.

  **Bell integration:** [NotificationBell.tsx](manicbot/admin-app/src/components/layout/NotificationBell.tsx) applies `groupNotifications` inside each `bellGroup()` time bucket («Новые» / «Ранее»), so groups never cross the 24h day-boundary. Group rows get a small `+N` chip next to the title and a `data-grouped="true"` + `data-group-count={N}` attribute pair for downstream tests + future inspector tooling. Click on a group marks ALL its unread rows as read in a single `markRead({ ids: [...] })` call and navigates to the representative's link.

  **Full-history integration:** [NotificationsClient.tsx](manicbot/admin-app/src/app/(dashboard)/notifications/NotificationsClient.tsx) applies the same per-time-bucket grouping (today / week / older). The trash-can dismiss on a group iterates over `allRows` so the user sees "delete this entry" working uniformly regardless of whether it's a single row or a 5-row burst.

  **Tests:** [src/__tests__/notification-grouping.test.ts](manicbot/admin-app/src/__tests__/notification-grouping.test.ts) (+11 cases — collapse threshold, 2h window boundary inclusive, kind-break, sourceSlug-break, null/undefined sourceSlug parity, custom `groupMin` / `windowSec`, empty input, mixed singles + groups ordering preservation). Existing bell + notifications-page tests updated to read `data-kind={rep.kind}` instead of `n.kind` (one-line attribute rename — semantically equivalent because `rep === row` in the single-item branch). Suite green: admin-app 4933/4933, worker 2652/2652, check-schema 91/91, typecheck clean.

  **Defaults rationale:** `groupMin=3` and `windowSec=7200` (2h) were picked from FB/VK observations — 3 is the threshold where a list of singles starts to feel "spammy" and 2h is roughly one shift's worth of activity at a busy salon, so morning-rush bursts collapse cleanly while still showing same-day-evening activity as a fresh group. Tune per-category via the options arg if a specific kind needs different cadence — no current need.

  **Not in PR-C (defer to PR-D):** avatars per row (needs a `user_notifications.avatar_url` migration + writer changes), inline `Подтвердить / Отклонить` buttons for `appointment.created` (needs new tRPC surface to act on a bell row), category filter chips above tabs (client-side only, straightforward addition once the grouping interaction is settled), Web Push payload enrichment (sw.js + VAPID payload changes).

**Smart Notification Center 2.0 — PR-D (per-category test fire, 2026-05-26):** the existing `notifications.sendTestNotification` only fired `support.test` (always-deliver, bypasses prefs gate). PR-D extends it with an optional `category` input so the user can confirm pipeline + opt-out behavior PER CATEGORY without crafting real triggers.

  **Router change:** [notifications.ts](manicbot/admin-app/src/server/api/routers/notifications.ts) `sendTestNotification` now accepts `{category?: NotificationCategory}` and dispatches `<category>.test` to `notifyWebUser`. When `category` is set, the prefs gate IS honoured — if the user opted out of `billing` in-app, the `billing.test` row gets `skippedByPrefs: true` in the response and the bell row is silently dropped. That's the point: the test button verifies BOTH that the writer can land a row AND that the user's opt-out is actually being respected. Legacy no-arg invocations keep firing `support.test` (the always-deliver carve-out is preserved).

  **UI:** [NotificationsSection.tsx](manicbot/admin-app/src/components/settings/sections/NotificationsSection.tsx) gains a fourth column (`Тест` / `Test` / etc.) in the categories table — a small `Sparkles` icon button per category row. Click → fires `sendTestNotification({category})` for that row's category. The legacy global "Send test" button under the push toggle stays (it now calls `handleTest()` with no arg → `support.test`). Grid switched from `[1fr,auto,auto]` → `[1fr,auto,auto,auto]`. New i18n keys `notifications.settings.col.test` and `notifications.settings.testBtnTitle` localized ru/ua/en/pl.

  **Tests:** [src/__tests__/notifications-router.test.ts](manicbot/admin-app/src/__tests__/notifications-router.test.ts) (+5 cases: auth gate, no-arg defaults to `support.test`, explicit `billing` → `billing.test`, sourceSlug stays `self_test`, zod rejects unknown category, smoke-check for the two PR-B categories `channel` + `client`). Suite green: admin-app 4938/4938, worker 2652/2652, typecheck clean, check-schema 91/91.

  **Not in PR-D (defer to a follow-up PR):** quiet hours (extends `notification_prefs` JSON shape — non-trivial server work), snooze category (mute timestamps + `shouldDeliver` mutation), daily digest for low-urgency kinds (new cron phase + new Resend template), avatars per bell row (schema migration), inline `Подтвердить / Отклонить` action buttons (needs `notifications.actOn` tRPC surface).

**Smart Notification Center 2.0 — PR-E (Blocker fix: bell pipeline silently broken in production, 2026-05-26):** prior to PR-E the `user_notifications` table was **EMPTY GLOBALLY** in prod. Every `notifyWebUser` call site was fire-and-forget (`void notifyWebUser(...)`), so on Cloudflare Pages the underlying `env.DB` binding from `getRequestContext()` was torn down with the response context BEFORE the Drizzle insert landed → silent throw inside `notifyWebUser` → `{ ok: false, error: 'db_insert_failed' }` returned to caller → caller's `.catch()` (which only catches throws) never fired → no row, no log, no `/errors` entry. Every salon-employed master, every support-ticket reply, every cross-staff DM, every birthday/appointment notification — all silently dropped. Diagnostic: `SELECT COUNT(*) FROM user_notifications` returned 0 in prod despite tables/indexes correctly created by migration 0070.

  **Root mechanism (worth remembering for future writers):** on Next.js 15 over `@cloudflare/next-on-pages`, the request context (and `env.DB` it carries) is short-lived. ANY unawaited promise that reaches into D1 after the mutation `return` runs `prepare()` on a dead handle. The pattern `void someDbCall(...)` is unsafe — always `await` user-visible writes in the mutation hot path, or use `executionContext.waitUntil` if you genuinely cannot block the response.

  **The fix is two-layered:**
  1. **All `void notify*` call sites converted to `await`** ([salon.ts sendMasterInvitation:2607](manicbot/admin-app/src/server/api/routers/salon.ts), [auth.ts getMyRole backfill:227](manicbot/admin-app/src/server/api/routers/auth.ts), [support.ts replyToTicket:165 + replyToMyTicket:291 + createTicket:415](manicbot/admin-app/src/server/api/routers/support.ts), [messenger.ts sendMessage:401](manicbot/admin-app/src/server/api/routers/messenger.ts)). Latency cost: one prefs read + one INSERT per write (~50ms p50) — negligible on the mutation hot path and the only way to keep the D1 binding alive.
  2. **New shared wrapper `notifyOrCapture`** ([server/services/notifyOrCapture.ts](manicbot/admin-app/src/server/services/notifyOrCapture.ts)) that combines the awaited `notifyWebUser` with a `captureError` sidecar on `{ ok: false }`. Surfaces every silent bell-write failure as a `notify.bell_write_failed` row in God Mode `/errors` so we don't get bitten by the same blind spot twice. Used by `salon.sendMasterInvitation` (the user-visible path that motivated the fix); the other 3 call sites use a plain `await notifyWebUser(...).catch(log)` since they don't surface bell-status in their mutation response.

  **Mutation response shape extension** on `salon.sendMasterInvitation`: now returns `{ ..., bellQueued: boolean, bellSkippedByPrefs?: true, bellError?: string }` (mirrors the existing `emailQueued / transportError` from PR-A). `bellQueued` is omitted entirely for new_user scenario (no `web_users` row to notify yet). UI in [InviteByEmailModal.tsx](manicbot/admin-app/src/components/salon/InviteByEmailModal.tsx) renders an amber chip when either email or bell failed, with per-case copy (`warningBellFailed` / `warningEmailFailed*` / `warningBothFailed`) localized ru/ua/en/pl.

  **Tests:** [src/__tests__/salon-invite-flow.test.ts](manicbot/admin-app/src/__tests__/salon-invite-flow.test.ts) (+5 cases for bell-write visibility: happy path returns `bellQueued: true`, failure surfaces `bellQueued: false + bellError` + fires `captureError` with `errorType='notify.bell_write_failed'`, opt-out returns `bellQueued: true + bellSkippedByPrefs: true`, captureError throw never breaks the mutation, regression-pin that proves the write completes BEFORE the mutation returns), [src/__tests__/notify-or-capture.test.ts](manicbot/admin-app/src/__tests__/notify-or-capture.test.ts) (6 cases pinning the helper's contract). Suite green: admin-app 278 files / 4987 passed, worker 196 files / 2656 passed, check-schema 91/91, typecheck clean. Tenant-isolation allowlist bumped 1751 → 1752 (the cross-tenant bot_id collision check shifted by 1 after the bell-state vars block landed in `sendMasterInvitation`).

  **Operator visibility going forward:** any `notifyWebUser` failure now writes an `error_events` row with `errorType='notify.bell_write_failed'`. Monitor `/errors` for 24h post-deploy; zero rows = healthy. Non-zero → triage. PR-A added the same loud-fail contract for email transport (`errorType='email.transport_failed'`); PR-E closes the parallel blind spot for in-app delivery.

**Notification kind taxonomy:** `<domain>.<event>` slugs. Current set: `reminder.fired`, `support.reply`, `support.ticket.new`, `support.ticket.reply`, `appointment.created`, `appointment.confirmed`, `appointment.cancelled`, `appointment.rescheduled`, `appointment.done`, `appointment.no_show_client`, `appointment.no_show_master`, `birthday.client`, `master.invite`, `platform.message`, `platform.reply`, `messenger.message` (PR-B), `channel.broken` / `channel.degraded` (PR-B), `billing.payment_failed` / `billing.trial_expiring_soon` (PR-B). Single source for icon + accent: `lib/notifications/kindMeta.ts` (exports `kindMeta`, `formatRelative`, `timeBucket`, `bellGroup` — the bell dropdown and `/notifications` both import from here so the two surfaces cannot drift). New writer = new kind slug; UI updates automatically.

**PR 2 (2026-05-17) — VK/FB-style redesign + first cron writers:**
- `NotificationBell` redesigned: per-kind icon + accent colour, relative time per row, «Новые / Ранее» group split (24h boundary), «Все / Непрочитанные» tabs driving the server-side `unreadOnly` filter, wider panel (22 rem mobile / 26 rem desktop). Pinned by `src/__tests__/notification-bell-redesign.test.ts`.
- `src/notifications.js` (`notifyAptStaff` + `notifyAptStaffAutoConfirmed`) now also writes a `user_notifications` row for the assigned non-synthetic master AND the tenant owner — kind `appointment.created` / `appointment.confirmed`. Synthetic personal-master rows (`is_synthetic = 1`) are skipped by design. `sourceId` = `${apt.id}:${kind}` so different lifecycle events don't collapse, same-event retries do.
- `src/handlers/cron.js` `processBirthdayAndReturningPromos` now fires `birthday.client` to the tenant owner alongside the existing client-facing Telegram promo. `sourceId` = `bday:${chatId}:${year}` so the 15-min cron cadence collapses to one row per year per client.
- Worker writer pin: `test/notification-writers-pr2.test.js`.

**PR 3 (2026-05-17) — Web Push (browser push notifications):**
- Migration `0073_push_subscriptions.sql` — one row per (web_user_id, endpoint) browser pair. Worker-side encryption uses the (p256dh, auth) ECDH keys per RFC 8291. `failure_count` is bumped on 404 / 410 from the push service; a future cleanup cron prunes dead rows.
- tRPC `pushSubscriptionsRouter` — `getVapidPublicKey` (returns `{enabled: false}` when env unset → UI hides the toggle), `subscribe` (UPSERT on the unique (user, endpoint) pair), `unsubscribe`, `list`. Every read/mutation pinned to `ctx.webUser.id`. Pinned by `src/__tests__/push-subscriptions-router.test.ts`.
- Service worker `manicbot/admin-app/public/sw.js` — handles `push` (renders native OS notification with kind-aware tag-based replace), `notificationclick` (focuses existing dashboard tab over spawning a new one), and `pushsubscriptionchange` (best-effort resync to `/api/push/resync`).
- Client hook `lib/notifications/usePushSubscription.ts` — registers the SW, calls `PushManager.subscribe` with the VAPID key, POSTs subscription back. Hides itself when `Notification` / `PushManager` is unsupported or VAPID isn't deployed. NotificationBell footer renders the «Включить пуши / Выкл» button when the hook reports the platform is ready.
- Worker `src/services/webpush.js` — full RFC 8291 sender using Web Crypto only (no `web-push` npm — incompatible with Workers runtime). Implements: P-256 ECDH → HKDF-SHA256 → AES-128-GCM with `aes128gcm` content-encoding; VAPID ES256 JWT signing. Single `sendWebPush(subscription, payload, vapid)` returns `{ok, status, body?}` so the caller can detect 404 / 410 and prune. Pinned by `test/webpush-encryption.test.js`.
- Worker `notifyWebUser` extended with `push?: boolean` (default true). Fans out to every `push_subscriptions` row of the recipient, no-ops when VAPID isn't configured (so the bell still works in the early-launch state). On 404 / 410 the row's `failure_count` is bumped.
- VAPID key generator: `node manicbot/scripts/generate-vapid-keys.mjs [--subject mailto:ops@example.com]`. Generates a P-256 keypair and prints the three env vars to set: `VAPID_PUBLIC_KEY` (Pages + Worker), `VAPID_PRIVATE_KEY` (Worker secret only), `VAPID_SUBJECT` (mailto). Until those are configured the push opt-in UI hides itself.
- **Bonus fix:** `src/http/adminAppProxy.js` was missing `/notifications`, `/channels`, `/errors`, `/invitations`, `/marketing-autopilot` — those dashboard pages all 404'd via the landing proxy. Whitelist updated + extra cases in `test/admin-app-proxy.test.js`.

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
- `/marketing`, `/marketing/*` (Marketing module — `MarketingShell` with **6**-tab sub-nav: Overview / Contacts / Campaigns / SMS / Automations / Templates). **This is the salon-owner CRM surface only.** The platform / sysadmin marketing center lives at `/system/marketing/*` (see "System (God Mode) routes" below). `MarketingShell` renders an amber banner pointing sysadmins to `/system/marketing` when `useMarketingScope` reports `mode: "admin"` (i.e. a sysadmin landed on `/marketing` without an active tenant preview) so the cross-tenant data never silently surfaces on the salon URL.
- `/notifications`, `/notifications/*` (Notification Center — full-history feed driven by `user_notifications`; bell footer links here). Pinned by `src/__tests__/notifications-route-whitelist.test.ts`.

`/marketing/providers` no longer exists as a tenant-reachable page — it is a server-side `redirect()` to `/system/providers` (system-admin-only, see below). Email/SMS vendor plumbing (Brevo, Resend, Twilio) is platform infrastructure and is intentionally NOT exposed under the salon-owner Marketing surface.

When adding a new top-level module that should not be intercepted by the role dashboard, extend the whitelist in `(dashboard)/layout.tsx` (currently four mirror blocks: `tenant_owner` / `tenant_manager` / `master` / `support`+`technical_support`). The whitelist logic is exercised by `src/__tests__/marketing-routing.test.ts`.

### System (God Mode) routes

`system_admin`-only pages live under `/system/*`:

- `/system` — environment / D1 table-stats / health dashboard (`SystemPageClient`).
- `/system/providers` — email/SMS transport (Brevo / Resend / Twilio) with health-check + enable/disable. Moved out of `/marketing/providers` so the salon-owner Marketing surface no longer leaks vendor identity. Server router is `marketing.providersList / providerHealthCheck / providerToggle` (all `adminProcedure`). The page itself adds a top-level role gate (`useRole().role === "system_admin" && !previewRole`) so a sysadmin previewing a tenant role gets the same placeholder a tenant would. Nav entry: `god.providers` in `lib/nav/navConfig.ts` (group `platform`). Pinned by `src/__tests__/marketing-providers-ia.test.ts`.
- `/system/customers` — **Platform Customers CRM**. Sysadmin-only view of "who registered as a salon owner, what plan, who pays, who churned" plus the newsletter directory. Two tabs (`?tab=accounts` default / `?tab=subscribers`). Accounts JOIN `web_users (role='tenant_owner') + tenants` with multi-select plan + status filters, search across email/name, 50/page offset pagination, MRR per row computed from a fixed catalog (`start=45 / pro=60 / max=90 PLN`, contributes only when `billing_status IN ('active','grace')`). Stats strip carries 6 KPIs (total_accounts, paying, trialing, churned, mrr_total_pln, newsletter_subs). Row click opens `PlatformCustomerDetailModal` (0062 stacking contract, deep-link to Stripe Dashboard via `tenants.stripe_customer_id`). Subscribers tab probes `newsletter_subscribers` first (parallel PR), falls back to the existing `email_subscribers`, and finally renders a "migration in flight" notice when neither table exists. **Read-only** — subscription mutations stay in Stripe Dashboard. Router: `platformCustomers.{stats, listAccounts, listSubscribers, accountDetail}` (all `adminProcedure`). Defensive role gate: rejects `previewRole` so a sysadmin previewing a tenant role cannot bleed cross-tenant data into the page. Nav entry: `god.customers` in `lib/nav/navConfig.ts` (group `platform`, just after `god.marketing`). Pinned by `src/__tests__/platform-customers-router.test.ts` (31 cases — auth, filter composition, pagination boundaries, stats math, tableMissing fallback, accountDetail NOT_FOUND, pure-helper price math) + `src/__tests__/system-customers-page.test.tsx` (13 cases — sysadmin happy path, 4 forbidden roles, sysadmin-under-tenant-preview rejection, tab switching via `?tab=`, tableMissing notice). Distinct from `/system/marketing/*` (per-tenant CLIENT CRM — a salon's marketing toward its own clients) and from `/tenants` (raw tenant table).
- `/system/marketing`, `/system/marketing/campaigns`, `/system/marketing/leads`, `/system/marketing/sends` — **Platform marketing center**. Sysadmin-only cross-tenant view: KPI cards (contacts, sends, delivery rate, active campaigns) + 7-day rollup + recent campaigns table on the overview; full campaigns list with inline send-stats drill-down on `/campaigns`; cross-tenant marketing-contacts directory with inline subscribed-toggle on `/leads`; platform-wide deliverability log on `/sends` (auto-refresh 30s, filter by status / recipient substring, joins `marketing_sends ← marketing_campaigns` so each row surfaces campaign name + tenant). Shell: `SystemMarketingShell` with amber "PLATFORM" badge so the surface is visually distinct from the salon-owner `MarketingShell`. Data flows entirely through the existing `marketing` router (`adminProcedure`, cross-tenant by design) — the salon-side `marketingTenant` router is intentionally NOT imported here. Nav entry: `god.marketing` in `lib/nav/navConfig.ts` moved from `/marketing` (management group) to `/system/marketing` (platform group), labelKey switched to `"Marketing Center"` (localized in ru/ua/en/pl). Pinned by `src/__tests__/system-marketing-ia.test.ts`. The `/sends` page is fed by the **Resend webhook** (`app/api/resend/webhook/route.ts`): events parsed by the pure-function `processResendEvent` in `~/server/marketing/webhooks/processResendEvent.ts` (Svix signature verified, then mapped to `marketing_sends` column patches — `delivered_at` / `opened_at` / `clicked_at` / `bounced_at` / `complained_at` set via `COALESCE` so retries can't clobber; status promotion is SQL-CASE-monotonic so terminal states `bounced` / `complained` / `failed` always win over `opened` / `clicked`). Brevo webhook ingestion is a separate follow-up — Brevo-routed sends stay at `queued / sent / failed` until that ships. Pinned by `src/__tests__/marketing-webhook-resend.test.ts` (13 cases — the full event matrix + edge cases).

### Modal stacking contract (0062 + Shell wrapper pin)

Every full-screen modal in the dashboard uses `fixed inset-0 z-[100] bg-slate-950/70 backdrop-blur-md` and a solid `bg-white` / `dark:bg-slate-900` card with `ring-1 ring-black/5`. This contract is locked by `src/__tests__/modal-styling-regression.test.ts`.

A subtle adjacent bug: the content wrapper inside `WebShell` and `Shell` previously carried `relative z-10`, which establishes a stacking context for `{children}`. A modal at `fixed inset-0 z-[100]` rendered inside that wrapper is **trapped** at the wrapper's z-layer; the sticky page header (z-30) sits in the parent stacking context and paints over the modal — visible as a light strip across the top of any open modal. Fix: drop `z-N` from both content wrappers, rely on DOM order (the orb decoration is positioned `absolute` earlier in the tree, so the content paints on top naturally). Pinned by `src/__tests__/shell-no-content-stacking-trap.test.ts`.

### Marketing modals — custom `Select`

All four tenant-reachable marketing modals (`AutomationFormModal`, `CampaignFormModal`, `TemplateFormModal`, `ReminderModal`) use the brand-styled `~/components/ui/Select.tsx` rather than the native `<select>`. Native dropdowns render at the OS layer, ignore page theming, and break inside the dark-overlay modal stack. Pinned by `src/__tests__/marketing-modals-no-native-select.test.ts`.

The same contract extends to God Mode (system_admin) page surfaces — `ErrorsPageClient` (severity / source / status filters), `ConversationsClient` (cross-tenant filter visible only when `role === "system_admin"`), and `MarketingAutopilotClient` (status filter) all use the custom `<Select>`. Pinned by `src/__tests__/god-mode-no-native-select.test.ts`. The `UsersPageClient` role-management modal also follows the 0062 modal stacking contract (`z-[100]` overlay, `bg-slate-950/70 backdrop-blur-md`, solid card with `ring-1 ring-black/5`) — pinned as a region anchor inside `modal-styling-regression.test.ts` (the page file itself uses `glass-card` for user-row cards, so the whole-file MODAL_FILES pin would not apply).

### Chat composer — Enter-to-send contract

Every chat-style composer in the admin-app honours one keyboard convention: **Enter sends, Shift+Enter inserts a newline**. Applies to:
- `MessageComposer.tsx` (`/messages` thread view) — original implementation, pattern source.
- `HelpSection.tsx` reply textarea (salon-owner ticket replies under `/settings?section=help`).
- `SupportDashboard.tsx` reply textarea (platform-staff `/platform-support` ticket replies).
- `Composer.tsx` (public salon AI chat at `/salon/{slug}/chat`).

The handler guards three conditions before firing the mutation: trimmed body must be non-empty (or an attachment must be present), the mutation must not already be pending, and the ticket/thread must be open. Pinned by `src/__tests__/ticket-composer-enter-behavior.test.tsx` for the two ticket surfaces.

### Chat composer — image attachments (drag / paste / click)

The same three composers (HelpSection, SupportDashboard, MessageComposer) accept PNG / JPEG / WEBP image attachments up to 2 MB via three input methods:

- **Click**: paperclip icon next to the Send button — opens the OS file picker.
- **Paste**: pasting an image from the clipboard (`Cmd+V` on a screenshot) into the textarea uploads it.
- **Drag-and-drop**: dropping a file anywhere on the composer container uploads it. The drop zone gets a brand-coloured ring while a file is hovering.

Upload flow:
1. Composer calls a tRPC mint procedure to get a short-lived signed URL:
   - `support.mintTicketUploadToken({ ticketId })` — works for ticket owners AND platform support staff (system_admin / support / technical_support). Falls back to the `_platform` sentinel tid for tickets with no `tenantId`.
   - `messenger.mintAttachmentUploadToken({ tenantId, threadId })` — gated by `assertThreadMember` (system_admin bypass still requires the thread to live in the tenant).
2. Browser POSTs the file to the Worker's `/upload/asset?t=<token>&kind=chat_attachment` endpoint (same as the salon-branding upload pipeline; new `chat_attachment` kind added to `ALLOWED_KINDS` in both `manicbot/src/services/upload.js` and `manicbot/admin-app/src/server/lib/uploadToken.ts`).
3. Worker writes the bytes to R2 under `t/{tid}/chat_attachment-{sha12}.{ext}` after magic-byte / MIME / size validation.
4. Composer receives the CDN URL, shows a preview chip, and includes it in the next `replyToMyTicket` / `replyToTicket` / `sendMessage` mutation.

Persistence shape:
- Tickets: single `attachmentUrl` text column on `platform_ticket_messages`. `replyToMyTicket` now accepts `attachmentUrl` (was missing); `replyToTicket` already did.
- Messenger: `attachments_json` on `thread_messages`, wrapped object `{ attachments: [{ url, kind }, …] }` so the schema can extend later. Capped at 4 attachments per message at the zod boundary.

The shared client primitives live in `~/lib/chatAttachments.ts` (`uploadChatAttachment`, `validateChatAttachmentFile`, `describeChatAttachmentError`, `ChatAttachmentUploadError`) and `~/components/chat/ChatAttachButton.tsx`. Pinned by `src/__tests__/chat-attachment-uploads.test.ts` (18 cases — auth, tenant isolation, env edges, JSON shape).

Inline image rendering: ticket and thread message lists render attachments as `<img>` when the URL ends with `.png|.jpg|.jpeg|.webp` (with or without query string); otherwise the URL is shown as a clickable text link (used for `telegram:` sentinel attachments and external URLs that staff paste manually into the SupportDashboard URL fallback field).


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
| `salon`          | `routers/salon.ts`          | `tenant_owner` for tenantId (`assertTenantOwner`). Owner-side master CRUD includes `updateMaster` (2026-05-17) which lets owners edit `name / tgUsername / bio / photo / vacationFrom / vacationUntil / onVacation` on masters they manage. Origin gating: `salon_created` → always editable; `invited_email` / `invited_telegram` → only when `masters.allow_delegation = 1`; `self_registered` → FORBIDDEN (master owns their own profile via `master.updateProfile`). Vacation rules mirror `master.setVacation` (both-or-neither, 2-year cap, `on_vacation` derived from now-in-range). |
| `master`         | `routers/masterRouter.ts`   | `master` or `tenant_owner` for tenantId                                                                         |
| `support`        | `routers/support.ts`        | platform staff: `support` / `technical_support` / `system_admin` (via `platform_roles`). PR1 (2026-05-17) added in-app notification fan-out: `replyToTicket` → `support.reply` to the ticket owner, `createTicket` + `replyToMyTicket` → `support.ticket.new` / `support.ticket.reply` to every support staff member except the creator. See Notification Center above. |
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
| `platformCustomers` | `routers/platformCustomers.ts` | adminProcedure (sysadmin-only Platform Customers page). Read-only. Procs: `stats`, `listAccounts({filters: {plans?, statuses?, search?}, page, pageSize})`, `listSubscribers({filters: {source?, lang?, confirmedOnly?}, page, pageSize})`, `accountDetail(webUserId)`. `listSubscribers` is defensive over a parallel schema migration — probes `newsletter_subscribers` first, falls back to `email_subscribers`, and returns `{ tableMissing: true, rows: [], total: 0 }` when neither exists. MRR catalog is `start=45 / pro=60 / max=90 PLN`, contributes only for `billing_status IN ('active','grace')`. |
| `marketing`      | `routers/marketing.ts`      | adminProcedure (God Mode global CRM view — cross-tenant by design). UI surface: `/system/marketing/*` (sysadmin platform marketing center). NEVER imported by the salon-owner `MarketingShell`. Procedures fully implemented: `stats`, `contactsList/Update`, `segmentsList/Create/Delete`, `templatesList/Create/Update/Delete`, `campaignsList/Create/Delete/SendNow/Stats/SendsList/AudiencePreview`, `activity` (7-day rollup), `providersList/HealthCheck/Toggle`, `automationsList/Create/Update/Toggle/Delete/RunNow`. `campaignSendNow` + `automationRunNow` delegate to the real `runCampaignSend` (`~/server/marketing/sender.ts`) — email path is production-ready via Resend; SMS path wired in code but provider plumbing matures in Phase 2 of the marketing roadmap. |
| `marketingTenant`| `routers/marketingTenant.ts`| protected + `assertTenantOwner` — every procedure takes `tenantId` and filters every WHERE by `tenant_id`. Sibling to `marketing` for the salon-owner / tenant_manager / personal-master / sysadmin-previewing surface served by `/marketing/*`. Same proc surface as `marketing` plus consent-log writes. Send path (`campaignSendNow`) delegates to `runCampaignSend` for both email AND SMS. **SMS is wired via Brevo** (the same provider that handles email) — gated on `BREVO_API_KEY` + `BREVO_SMS_SENDER` env vars; the `twilio` entry in `~/server/marketing/providers/index.ts` is `null` (reserved for a future SMS-only provider). `/marketing/sms` UI is real — it conditionally renders a "coming soon" facade when SMS is not configured, otherwise renders the working campaign composer. |
| `pluginReminders`| `routers/pluginReminders.ts`| managerProcedure + `assertTenantMember` + `assertPluginEnabled('reminders')`. CRUD + `listForCalendar` (expanded occurrences). `master` role can only edit own reminders (creator-id check). Recurrence validated by the shared `validateRecurrence` DSL helper (same code as Worker cron). |
| `notifications`  | `routers/notifications.ts`  | protectedProcedure. `list`, `unreadCount`, `markRead`, `markAllRead`, `dismiss`. All ops scoped by `ctx.webUser.id` — no cross-user reads. Consumed by `NotificationBell` in `Shell.tsx` (polls every 30s closed, 5s open). |
| `platformMessenger` | `routers/platformMessenger.ts` | Migration 0076 — ManicBot ↔ owner DM + broadcasts. Owner-side (`getMyThread / markMyThreadRead / sendMyReply`) is `protectedProcedure` scoped by `ctx.webUser.id` (IDOR impossible). Sysadmin-side (`listThreads / getThread / sendDirectMessage / markThreadReadAsPlatform / broadcast / previewAudience / listBroadcasts / unreadCount`) is `systemAdminProcedure`. Audience is a zod discriminated union (`all` / `by_plan` / `by_billing_status`); broadcast stamps the same `broadcast_id` on every emitted message row. Owner replies fan out `platform.reply` to every system_admin; sysadmin sends fan out `platform.message` to the recipient. |
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


### Appointments rail cleanup (2026-05-26)

Three UX papercuts on the Appointments tab, all addressed in one PR:

- **Status filter — vertical 5-row toggle list → single-select `FilterDropdown`.**
  The old card hogged ~180 px of rail height and looked clumsy next to
  the mini-month. The new dropdown matches the brand pattern used in
  `/errors`, `/conversations`, `/system/marketing/sends`. State changes
  in [SalonDashboard.tsx](manicbot/admin-app/src/components/dashboards/SalonDashboard.tsx)
  and [AppointmentsPageClient.tsx](manicbot/admin-app/src/app/(dashboard)/appointments/AppointmentsPageClient.tsx):
  `hiddenStatuses: Set<StatusKey>` → `statusFilter: StatusKey | null`.
  Persistence in localStorage switched key
  `manicbot_apt_hidden_statuses` → `manicbot_apt_status_filter`.
- **Service filter — same treatment.** `hiddenServiceIds: Set<string>` →
  `serviceFilter: string | null`. Service catalog can grow large, the
  toggle list scrolled awkwardly; single-select is cleaner.
- **Auto-confirm section deleted from the rail.** It already lives
  canonically in `/settings?section=salon` (MySalonSection →
  AutoConfirmSettings); having a second copy in the rail confused
  owners about which surface was the source of truth.
  `autoConfirmQuery` / `autoConfirmMut` removed from SalonDashboard.

[CalendarLeftRail.tsx](manicbot/admin-app/src/components/dashboards/CalendarLeftRail.tsx)
prop surface shrunk: dropped `hiddenStatuses / toggleStatusVisible /
showAllStatuses / hiddenServiceIds / toggleServiceVisible /
showAllServices / autoConfirm / autoConfirmLoading / setAutoConfirm`;
added `statusFilter / setStatusFilter / serviceFilter /
setServiceFilter`. New i18n key `salon.rail.filters` (ru/ua/en/pl).
Test coverage: [CalendarLeftRail.test.tsx](manicbot/admin-app/src/__tests__/CalendarLeftRail.test.tsx)
(21 cases — full re-pin for the dropdown contract + an explicit
"auto-confirm panel must NOT render anywhere on the rail" regression
guard).


### Unassigned-master manual bookings (2026-05-26)

`appointments.createManual` now accepts `masterId: undefined` for
owner / system_admin role. Salons with an empty master roster (just
registered, or in onboarding) can finally create bookings without
having to add a master first — the row lands in D1 with
`master_id = NULL` and the synthetic Unassigned column in `SalonDayView`
(chatId = -1) surfaces it. Master role is still required to specify
their own `masterId`; a master attempting to create an unassigned
booking gets `FORBIDDEN: Masters can only book on their own calendar`.

Backend ([routers/appointments.ts](manicbot/admin-app/src/server/api/routers/appointments.ts)):
- zod input relaxed: `masterId: z.number().int().optional()`.
- Master-role IDOR check: rejects when `masterId` is undefined before
  any DB work.
- Per-master block check (`master_client_blocks`) skipped when masterId
  is undefined — the block is keyed by (tenant, master, client), so
  there is no per-master scope without a master.
- `slotsBusy` skipped when masterId is undefined — slot conflicts are
  per-master; once the owner assigns a master via
  `appointments.update` the conflict guard fires there.
- Insert writes `masterId: input.masterId ?? null`.

UI ([ManualBookingModal.tsx](manicbot/admin-app/src/components/dashboard/ManualBookingModal.tsx)):
new sentinel `UNASSIGNED_MASTER_VALUE = "unassigned"` shown as
«— Без мастера —» at the top of the master Select. Hidden when the
modal is locked to a specific master (drag-to-create on a master
column already binds the row). Submit omits the `masterId` field
entirely when chosen. `mastersEmpty` no longer disables the Select —
the unassigned option is always available, so the previous "Najpierw
dodaj mistrza w zakładce «Mistrzowie»" dead-end is gone. New i18n key
`appointments.manual.masterUnassigned` (ru/ua/en/pl). Test coverage:
[appointments-create-manual-unassigned.test.ts](manicbot/admin-app/src/__tests__/appointments-create-manual-unassigned.test.ts)
(4 cases — new-client + existing-client happy paths, master-role
refusal, and a backward-compat regression with `masterId` set).


### Masters tab row → MasterDetailModal (2026-05-17)

Owner UX parity with the Clients tab. Previously the master row in
`/dashboard?tab=masters` carried only two inline icons — "hide from
public profile" (eye) and "delete" (trash) — and there was no way to
edit `name / tg handle / bio / photo / vacation` from the owner side.
Independent + invited masters update their profiles through
`master.updateProfile`, but accounts created via "Создать аккаунт через
web" (`origin = 'salon_created'`) had no owner-side editor at all.

The fix mirrors `ClientRow` → `ClientDetailModal`:

- **Row is now a `<button>`** ([SalonDashboard.tsx](manicbot/admin-app/src/components/dashboards/SalonDashboard.tsx)) — click opens
  [MasterDetailModal.tsx](manicbot/admin-app/src/components/salon/tabs/masters/MasterDetailModal.tsx). Inline eye + trash
  icons removed; all actions live inside the modal.
- **Top-right header buttons removed** ("Добавить через Telegram" /
  "Создать аккаунт") — they were a transition-period duplicate of the
  bottom-right `AddMasterFab` which already covers all three add-flows
  (`create_account` / `add_telegram` / `invite_email`).
- **Backend mutation** `salon.updateMaster` (see Router table above)
  with origin gating — `salon_created` always editable, `invited_*`
  only when `allowDelegation = 1`, `self_registered` rejected. Vacation
  validation mirrors `master.setVacation`.
- **`salon.getMasterDetail`** extended to return `vacationFrom`,
  `vacationUntil`, `onVacation`, `allowDelegation` so the modal can
  hydrate the edit form and decide whether to show the lock notice.
- **Modal stacking contract (0062)** — pinned in
  `src/__tests__/modal-styling-regression.test.ts` (the
  `MasterDetailModal` path was added to `MODAL_FILES`).
- **Tests** — `src/__tests__/salon-update-master.test.ts` (17 cases:
  6 origin/delegation, 2 authorization, 7 vacation, 2 sanitization +
  no-op).


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
npm test                     # Worker Vitest (~2656 tests, 196 files)
npm run check-schema         # D1: table + column parity between schema.sql and Drizzle schema.ts

cd admin-app/
npm run typecheck
npm test                     # Mini App Vitest (~4987 tests, 278 files)
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
- `INTERNAL_API_TOKEN` — shared with admin-app Pages env var of the same name. Used by Worker `/api/subscribe` to call admin-app `/api/internal/newsletter-welcome`. When unset, the newsletter welcome step is a graceful no-op (subscriber still lands in D1, `welcome_send_error` is stamped). Use a 32+ char CSPRNG string.

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
- `INTERNAL_API_TOKEN` — shared secret between Worker and admin-app for Worker→admin-app internal calls. Set the SAME value as a Worker secret via `wrangler secret put INTERNAL_API_TOKEN`. First consumer is the newsletter welcome pipeline (Worker `/api/subscribe` → admin-app `POST /api/internal/newsletter-welcome`). When unset, the welcome step is a graceful no-op and `newsletter_subscribers.welcome_send_error` is stamped — the public 202 stays unchanged so the form UX never regresses on misconfig.
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
| `platform_threads`         | Singleton ManicBot ↔ owner DM channel (migration 0076). UNIQUE on `recipient_web_user_id`.        |
| `platform_thread_messages` | Append-only message log for `platform_threads`; ULID PK; `broadcast_id` groups broadcast rows.    |
| `platform_broadcasts`      | Audit row per broadcast (sender, audience filter JSON, recipients_count). One per `broadcast()` call. |


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

