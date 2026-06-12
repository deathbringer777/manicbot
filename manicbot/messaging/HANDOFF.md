# System & Seasonal Messaging — Handoff

Built on branch `feat/system-messaging`. Two tiers, one delivery ledger, DRAFT-gated
by `MESSAGING_SEND_ENABLED` (default `"0"` — nothing reaches a real tenant until you flip it).

## Что построено

**Tier 1 — Worker (реактивный, real-time)**
- `src/services/reactiveMessaging.js` — `fireReactiveMessage` / `fireReactiveForTenant`: доставка
  системных/биллинговых сообщений через тот же ledger `platform_campaign_deliveries`, что и cron-кампании.
  Резолвер шаблонов по `template_key` с локалью tenant'а и фолбэком EN. Флаг off → строка ledger
  `skipped_flag`, нулевой egress.
- Wired в `src/billing/webhooks.js` (5 событий, fire-and-forget, не блокируют Stripe 200):
  `invoice.payment_failed` → `sys_payment_failed`; dunning-recovery `invoice.paid` → `sys_payment_success`;
  `subscription.updated` (смена плана) → `sys_plan_changed`; `subscription.deleted` → `sys_subscription_expired`;
  `trial_will_end` → `sys_trial_ending`.
- Сезонные кампании (`platform_campaigns.occasion_key`) гейтятся флагом в `phasePlatformCampaigns`.

**Tier 2 — ThinkPad (плановый/генеративный)** — `~/automation/messaging/` (PM2):
- `msg-holidays-sync` (daily 06:00) — `date-holidays` PL + `commercial-dates.json` → `holiday_calendar`.
- `msg-content-plan` (daily 06:30) — ближайшие 35 дней → draft `announcement`-кампании (occasion_key, 10:00 Warsaw).
- `msg-preset-gen` (weekly Mon 05:00) — `claude -p` (Sonnet) генерит сезонные шаблоны ×4 локали → draft templates.
- `msg-health` (hourly :15) — счётчики черновиков.
- tg-bot команды (owner-only): `/drafts`, `/preview <id>`, `/approve <id>`, `/skip <id>`, `/msgsend <id>`.

**Seam** — `src/http/messagingHttp.js` `/admin/messaging/*` (Bearer `MESSAGING_TOKEN`):
holidays-upsert · template-draft · campaign-draft · approve · drafts (GET) · promo-mint.

**Promo** — `src/billing/promoCodes.js` `mintSeasonalPromo` (Stripe coupon + promotion_code, TEST-mode,
persisted в `subscription_promo_codes`); `{promoCode}`/`{expiresAt}` рендерятся в сезонных шаблонах.

**Admin UI** — `/system/marketing/broadcasts`: статус-чипы шаблонов (DRAFT/APPROVED/ARCHIVED),
approve/archive, секция content-plan (occasion-кампании) с approve/skip.

**Migrations** 0118 (templates extend) · 0119 (holiday_calendar) · 0120 (campaign occasion + subscription_promo_codes) · 0121 (seed 20 reactive billing templates ×4 locale).

## Как управлять

- **Посмотреть черновики:** tg-bot `/drafts` (или Broadcasts UI). **Одобрить:** `/approve <id>` или кнопка в UI.
- **Сгенерить пресеты вручную:** `cd ~/automation/messaging && npm run presets [occasion_key]`.
- **Пересобрать календарь:** `npm run holidays`. **Пересобрать план:** `npm run plan`.
- **Добавить повод:** допиши `commercial-dates.json` (в репо `manicbot/messaging/thinkpad/`), задеплой на ThinkPad, перезапусти `msg-holidays-sync`.
- **Промокод к сезонной кампании:** seam `POST /admin/messaging/promo-mint {campaign_id, code, percent_off, expires_days}`.

## Включение реальных отправок (go-live)

1. Просмотри одобренные шаблоны/кампании (`/drafts`, UI).
2. `cd manicbot && npx wrangler secret put MESSAGING_SEND_ENABLED` → введи `1` (или правь `wrangler.toml [vars]` и редеплой).
   Промокоды переключатся на live, когда `STRIPE_SECRET_KEY` станет live-ключом (сейчас TEST).
3. Реактивные биллинг-сообщения и одобренные сезонные начнут реально доставляться в news-канал/bell/TG.

## Rollback
- Выключить: `MESSAGING_SEND_ENABLED="0"` (мгновенно стейджит всё назад, egress = 0).
- Полный откат: revert PR; миграции аддитивны (новые колонки/таблицы), старый код их игнорирует.

## Секреты (прод, вручную)
- `wrangler secret put MESSAGING_TOKEN` — значение совпадает с `~/automation/messaging/.env` на ThinkPad (600).
- `MESSAGING_SEND_ENABLED` — в `wrangler.toml [vars]` = "0".
- **PENDING (твоё действие):** ротация `TELEGRAM_TOKEN` + `GROQ_KEY` на ThinkPad (BotFather / Groq console) —
  код уже env-based, но прежние значения стоит сменить.

## Dry-run (flag off) — что проверить
Fake Stripe `invoice.payment_failed` (test mode) → строка `platform_campaign_deliveries` со статусом
`skipped_flag`, ноль `platform_thread_messages`. Повторный вебхук → строк не прибавилось (идемпотентность по
`occurrence_key`). `msg-content-plan` → draft-кампании в `/drafts`. `/approve` → статус `active`, но без egress
пока флаг off.
