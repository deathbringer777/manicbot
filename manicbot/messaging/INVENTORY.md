# System & Seasonal Messaging — Inventory (2026-06-12)

What already exists vs. what the new service adds. Anchored to migration **0117** (next = 0118).

## Reused as-is (the spine)
- **`platform_campaigns`** (0100) — campaign definitions; kinds `announcement|monthly_report|subscription_reminder|welcome`. Status enum already covers `draft|scheduled|active|paused|done|failed`. → **content_plan** lives here (rows with `occasion_key`).
- **`platform_campaign_deliveries`** (0100) — idempotency ledger, claim-by-INSERT on UNIQUE `(campaign_id, occurrence_key, recipient_web_user_id, channel)`, tenant-scoped. → **message_deliveries** is this, unchanged.
- **`platform_message_templates`** (0100/0116) — template library; 7 builtins (`is_builtin=1`, RU). → **message_templates** is this, extended (template_key, status, variables_json, locale rows).
- **`platform_threads` / `platform_thread_messages`** (0076) — the in-app "News & Announcements" center channel. Center delivery already implemented (`deliverCenter`).
- **Dispatch engine** `src/services/platformCampaigns.js`: pure `isCampaignDueForTenant()` due-engine + `phasePlatformCampaigns()` cron phase (runs in `cron.js:1520`, 60s phase window). Channels center/bell/telegram/email all implemented + opt-out aware. Singleton pattern (`sys_welcome`, deterministic id, partial UNIQUE on kind).
- **Personalization** `platformCampaignVars.js`: `{salon_name}{owner_name}{first_name}{plan}` (+ TS twin in admin-app `welcomeOnRegister.ts` — keep in lockstep).
- **Stripe coupons** `src/billing/stripe.js`: `ensureCoupon()` (idempotent, immutable-economics guard), `applyCouponToSubscription()`. Checkout sets `allow_promotion_codes: true` (`stripe.js:89`). → promo module wraps these with `createPromotionCode()` + a persisted `promo_codes` table.
- **Billing webhooks** `src/billing/webhooks.js`: payment_failed (→grace + bell + email via `notifyTenantOwner`), payment_succeeded, subscription.updated (plan upgrade email), trial_will_end → all the reactive trigger points.
- **Admin UI** `/system/marketing/broadcasts` (`BroadcastsClient.tsx`, router `platformBroadcasts.ts`, all `systemAdminProcedure`) — campaign CRUD, template CRUD, TokenPalette, TemplatesLibrary, audience preview. admin-app writes D1 directly via Drizzle.
- **Auth/secrets** `src/utils/security.js` `timingSafeEqual`; `src/http/adminKeyHttp.js` Bearer ADMIN_KEY / NOTIFY_TOKEN pattern + per-credential rate-limit.

## New (this service adds)
- **Migration 0118** — extend `platform_message_templates`: `template_key TEXT`, `status TEXT DEFAULT 'draft'`, `variables_json TEXT`; partial UNIQUE `(template_key, locale)`; builtins backfilled `status='approved'`. Extends category vocabulary (`system|billing|reactive|seasonal|promo|news`).
- **Migration 0119** — `holiday_calendar` (platform-scoped, no tenant_id): `date, country, occasion_key, name_pl/ru/uk/en, type, recurrence_json`; UNIQUE `(occasion_key, date)`.
- **Migration 0120** — `platform_campaigns.occasion_key TEXT`, `template_key TEXT` (content-plan linkage); `promo_codes` table (Stripe promo code persistence + render source).
- **Reactive engine** `src/services/reactiveMessaging.js` — `fireReactiveMessage()` event-driven delivery through the existing ledger; locale-resolving template loader (tenant lang → EN fallback); `MESSAGING_SEND_ENABLED` gate (off → ledger row `skipped_flag`, zero egress). New cron-due kinds (`onboarding_incomplete`, `inactivity`, `usage_milestone`, `trial_ending`).
- **Promo module** `src/billing/promoCodes.js` — `createPromotionCode()` (wraps `ensureCoupon`), persist to `promo_codes`, render `{promoCode}/{expiresAt}`. TEST-mode Stripe only until go-live.
- **Worker integration endpoints** `src/http/messagingHttp.js` — `/admin/messaging/*` (Bearer `MESSAGING_TOKEN`): holidays-upsert, template-draft, campaign-draft, approve, drafts (GET), stats (GET), plan (GET), calendar (GET), reschedule, flag (operator send-pause), promo-mint. Server-to-server seam for the ThinkPad + tg-bot control panel.
- **ThinkPad tier** `~/automation/messaging/` — holidays-sync, content-plan-builder, preset-generator (`claude -p` Sonnet), scheduler health crons; PM2. tg-bot extended with `/drafts /preview /approve /skip /send`.
- **Admin UI delta** — template status chips (DRAFT/APPROVED), per-locale preview, approve/archive; content-plan list (campaigns with occasion_key).

## Master-prompt corrections (confirmed during scan)
1. No `/admin/platform-campaigns` Worker endpoint — admin-app writes D1 directly. New seam = `/admin/messaging/*`.
2. `platform_message_templates` already has `monthly_report`/`subscription_reminder` localized (ru/ua/en/pl in `platformCampaignStats.js`); only the **builtin starter templates** are RU-only. The new per-locale template rows fix seasonal/reactive localization.
3. Stripe coupon mechanics already exist — promo module extends, not invents.
4. Design palette = slate+purple+green (beige/red/turquoise reverted). Last migration 0117 (skill's 0089 stale).
5. ThinkPad: no `bot_remote.js`/`~/automation/crons`; structure is `tg-bot/` + `crons.json`; secrets already env (`.env` 0600).
