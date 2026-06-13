# System & Seasonal Messaging — Architecture

One ecosystem, two tiers, one delivery ledger. Latency-sensitive/event-driven = **Cloudflare Worker**;
scheduled/generative/heavy = **ThinkPad**. Everything DRAFT-gated by `MESSAGING_SEND_ENABLED` (default `0`).

```
                         ┌──────────────────────────────────────────────┐
   Stripe webhooks ─────▶│  TIER 1 — Worker (reactive, real-time)        │
   billing state         │  src/billing/webhooks.js                      │
   cron (*/15)           │    └▶ fireReactiveMessage()                   │
                         │  src/services/reactiveMessaging.js            │
                         │    • template resolver (locale→EN fallback)   │
                         │    • MESSAGING_SEND_ENABLED gate              │
                         │    • SAME ledger: platform_campaign_deliveries│
                         │  src/services/platformCampaigns.js (dispatch) │
                         └───────────────┬──────────────────────────────┘
                                         │ writes (raw SQL, owns D1 binding)
                                         ▼
                              ┌────────────────────┐      reads (Drizzle)
                              │   D1: manicbot-db   │◀──────────────────────┐
                              │  platform_campaigns │                       │
                              │  ..._deliveries     │                       │
                              │  ..._templates      │              ┌────────┴─────────┐
                              │  holiday_calendar   │              │  admin-app        │
                              │  promo_codes        │              │  Broadcasts UI    │
                              └─────────▲───────────┘              │  (systemAdmin)    │
                                        │ writes via               └───────────────────┘
                                        │ /admin/messaging/* (Bearer MESSAGING_TOKEN)
                         ┌──────────────┴───────────────────────────────┐
                         │  TIER 2 — ThinkPad (scheduled, generative)    │
                         │  ~/automation/messaging/  (PM2, Node 22)      │
                         │   • holidays-sync   (date-holidays PL)        │
                         │   • content-plan-builder (rolling month)      │
                         │   • preset-generator (claude -p Sonnet)       │
                         │   • scheduler health                          │
                         │  ~/automation/tg-bot/ (approval surface)      │
                         │   /drafts /preview /approve /skip /send       │
                         └───────────────────────────────────────────────┘
```

## Tier 1 — Reactive (Worker)

**Module:** `src/services/reactiveMessaging.js`.

`fireReactiveMessage(ctx, { kind, tenant, recipients, occurrenceKey, vars })`:
1. Resolve template: `SELECT … FROM platform_message_templates WHERE template_key = ? AND status='approved' AND locale IN (?, 'en')`; prefer tenant locale, else EN, else the RU builtin. (Missing template in tests = hard fail.)
2. Interpolate `bodies_json` via `renderTemplateVars` with `vars` (must include every `{token}` the template declares in `variables_json`; a missing variable throws in test mode).
3. For each channel × recipient: `tryClaimDelivery()` (existing ledger) → if `MESSAGING_SEND_ENABLED !== '1'` write the ledger row with status `skipped_flag` + `log.info` and **return without egress**; else `deliverChannel()` (existing).
4. `occurrenceKey` = the natural event anchor → idempotent (Stripe invoice id, subscription period end, `YYYY-MM-DD` for daily nudges).

**Event sources & kinds:**

| kind | trigger | occurrence_key | quiet-hours |
|------|---------|----------------|-------------|
| `sys_payment_failed` | webhook `invoice.payment_failed` | invoice id | exempt (transactional) |
| `sys_payment_success` | webhook `invoice.payment_succeeded` | invoice id | exempt |
| `sys_plan_changed` | webhook `subscription.updated` (plan delta) | `${sub}:${newPlan}` | exempt |
| `sys_subscription_expired` | webhook `subscription.deleted` | subscription id | exempt |
| `sys_trial_ending` | webhook `trial_will_end` (reuse) | trial-end epoch | exempt |
| `sys_renewal_reminder` | **existing** `subscription_reminder` singleton (cron) | renewal epoch | 09:00 |
| `sys_onboarding_incomplete` | cron-due (onboarding not all_completed after N days) | `YYYY-Www` | 10:00–20:00 |
| `sys_inactivity` | cron-due (no login X days) | `YYYY-Www` | 10:00–20:00 |
| `sys_usage_milestone` | cron-due (Nth booking crossed) | `milestone:${n}` | 10:00–20:00 |
| `seasonal:<occasion>` | cron-due via `holiday_calendar` + content_plan campaign | `YYYY:<occasion>` | **10:00–20:00 Europe/Warsaw** |

Webhook-driven kinds call `fireReactiveMessage` directly (fire-and-forget, like `notifyTenantOwner`).
Cron-driven kinds extend `isCampaignDueForTenant()` with new `due*` branches + a quiet-hours gate for
seasonal/behavioral (`atOrAfter(now,10,0) && !atOrAfter(now,20,0)`); billing kinds skip the gate.

## Tier 2 — ThinkPad (scheduled/generative)

`~/automation/messaging/` (English code). Each cron pushes through the Worker seam — **never writes D1
directly**. Reuses `_shared/PRODUCT.md` + `BRAND.md` (scp'd, never committed) as the only fact/voice source.

- **holidays-sync** (daily 06:00): `date-holidays` (country PL) + curated `commercial-dates.json` (beauty-
  industry dates) → `POST /admin/messaging/holidays-upsert`. Idempotent (occasion_key+date).
- **content-plan-builder** (daily 06:30): reads holiday_calendar 35 days ahead → for each occasion creates a
  draft `seasonal:<occasion>` campaign (status `draft`, `occasion_key`, `scheduled_at` = occasion date 10:00
  Warsaw) via `POST /admin/messaging/campaign-draft`. Idempotent on `(occasion_key, YYYY)`.
- **preset-generator** (weekly / on-demand): `claude -p` Sonnet generates the preset library (all categories ×
  RU/UK/PL/EN) → `POST /admin/messaging/template-draft` (status `draft`). Facts ONLY from PRODUCT/BRAND md.
- **reflow-templates** (one-shot / on-demand, `npm run reflow`): re-paragraphs the EXISTING `seasonal_*` draft
  templates (legacy single-paragraph copy → `\n\n` blocks) without re-running the LLM. Seam-only: `GET drafts`
  → `reflowToParagraphs` (`lib/format.js`) → `POST template-draft`. Idempotent (skips already-paragraphed);
  `REFLOW_DRY_RUN=1` previews. Re-sends `channels` (the upsert defaults a missing `channels` to `['center']`,
  which would drop `bell`).
- **scheduler health** (hourly): `GET /admin/messaging/drafts`, reports counts + cron health to TG.

**Seasonal copy structure (convention):** every generated/authored body is **2–3 short, scannable paragraphs
separated by a blank line (`\n\n`)** — greeting / value / call-to-action — so the `whitespace-pre-wrap`
announcement renderer shows paragraphs, not a wall of text. The preset-generator prompt asks the model for
this; `normalizeBody` tidies the output and `reflowToParagraphs` is the fallback if the model returns a single
block. Unit-tested via `node --test` (`format.test.js`, `preset-generator.test.js`; runner injected — no real CLI).

**tg-bot approval** (`~/automation/tg-bot/`, ALLOWED_USER_ID-only): `/drafts` (list), `/preview <id>`,
`/approve <id>` (→ `POST /admin/messaging/approve` flips draft→active/scheduled), `/skip <id>`, `/send <id>`
(still requires `MESSAGING_SEND_ENABLED=1`), `/retract <bc_…|message_id>` (confirm-gated →
`POST /admin/messaging/message-retract`). New `.env`: `MESSAGING_TOKEN`, `WORKER_URL`.

## Integration seam — `src/http/messagingHttp.js`

Mounted in the Worker router; Bearer `MESSAGING_TOKEN` (new low-priv secret, `timingSafeEqual`, rate-limited
via existing `requireAdmin`-style guard). All writes go to D1 via the Worker's raw-SQL helpers (same shapes
the admin-app Drizzle writes). Endpoints:

| Method | Path | Body | Action |
|--------|------|------|--------|
| POST | `/admin/messaging/holidays-upsert` | `{rows:[{date,country,occasion_key,name_*,type,recurrence}]}` | upsert holiday_calendar (idempotent) |
| POST | `/admin/messaging/template-draft` | `{template_key,locale,name,category,channels,bodies,variables}` | upsert draft template by (template_key,locale) |
| POST | `/admin/messaging/campaign-draft` | `{occasion_key,template_key,title,bodies,channels,audience,scheduled_at}` | upsert draft seasonal campaign (idempotent on occasion_key+year) |
| POST | `/admin/messaging/approve` | `{id,status:'active'\|'scheduled'\|'skipped'}` | flip campaign status (shared with UI) |
| POST | `/admin/messaging/template-status` | `{template_key\|id,status:'approved'\|'draft'\|'archived'}` | approve/archive draft templates; `template_key` flips ALL non-builtin locales of an occasion at once (tg-bot per-occasion ✅/⏭) |
| POST | `/admin/messaging/backfill-welcomes` | — | one-off: deliver the sys_welcome message BACKDATED to registration to every owner missing it (idempotent via the delivery ledger; in-app center only, no bell) |
| POST | `/admin/messaging/message-retract` | `{broadcast_id}` \| `{message_id}` | God-Mode retract: hard-delete the matching `platform_thread_messages` copies (+ the `platform_broadcasts` audit row for a `broadcast_id`) across ALL recipient threads, then RECOMPUTE each affected thread's `last_message_*` from the newest remaining message (or null when empty). Idempotent (re-run → 0); unknown id → 0. Returns `{removed, threads_touched}`. Shared `retractBroadcast()` lives in `src/services/platformRetract.js`; the admin-app `platformMessenger.retractBroadcast` mutation mirrors the same recompute semantics. No FTS (that index covers `thread_messages`, not the platform table). Does NOT re-welcome emptied channels — that is a separate `backfill-welcomes` step. |
| GET | `/admin/messaging/drafts` | — | list draft campaigns + templates (for tg-bot) |
| GET | `/admin/messaging/stats` | — | counts by status, deliveries by channel, send_enabled (env) + send_paused (D1), next_scheduled |
| GET | `/admin/messaging/plan?days=N` | — | upcoming scheduled campaigns (any status but done) within the window |
| GET | `/admin/messaging/calendar?days=N` | — | upcoming holiday_calendar occasions within the window |
| POST | `/admin/messaging/reschedule` | `{id,scheduled_at}` | move a campaign's scheduled_at (keeps next_run_at in sync for live statuses) |
| POST | `/admin/messaging/flag` | `{paused:boolean}` | operator secondary send-pause (D1 `platform_settings.messaging_send_paused`); env stays master |
| POST | `/admin/messaging/promo-mint` | `{campaign_id,percent_off,duration,expires_days}` | mint Stripe promo (TEST), persist promo_codes |

## Promo module — `src/billing/promoCodes.js`
- `createPromotionCode(secretKey, { couponCode, code, expiresAt, maxRedemptions })` — `ensureCoupon()` then
  `POST /v1/promotion_codes` (idempotent: list by `code` first). Persist to `promo_codes`
  `(id, code, coupon_code, campaign_id, percent_off, expires_at, stripe_promo_id, livemode, created_at)`.
- Render: `buildCampaignVars` gains `{promoCode}` / `{expiresAt}` when a campaign has a linked promo row.
- **TEST mode only** until go-live (uses the test secret key); `livemode` column records which.

## Guardrails realized
- `MESSAGING_SEND_ENABLED` default `0` — flag-off writes ledger `skipped_flag`, zero external egress.
- Tenant isolation: every delivery row carries `tenant_id`; templates/campaigns/holidays platform-scoped
  (tenant-scan-ignore with reason). Cross-tenant ops `systemAdminProcedure` (UI) / `MESSAGING_TOKEN` (seam).
- Idempotency: existing ledger UNIQUE key; holiday UNIQUE(occasion_key,date); promo list-before-create.
- Quiet hours: seasonal/behavioral gated to 10:00–20:00 Warsaw; billing transactional exempt.
- Rate limits: delivery rides the existing per-tenant cron fan-out (queue `manicbot-tenant-cron`), not a loop.
- Secrets: `MESSAGING_TOKEN` via `wrangler secret put`; Stripe test key only; nothing logged.
- Sanitization: the Worker seam's `clean()` strips control chars but KEEPS `\n`/`\t` (paragraph structure
  survives to D1). Operator-authored bodies in admin-app use `sanitizeMessageBody` (newline-preserving) at the
  DM/broadcast/campaign/welcome write sites (`platformMessenger`, `platformBroadcasts`); one-line fields
  (titles, names, email subjects) stay on `sanitizeText`, and rich email HTML stays on `sanitizeHtml`.
