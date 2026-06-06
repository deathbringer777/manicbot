-- 0110_platform_welcome.sql — 2026-06-06
--
-- Welcome-on-registration for the "ManicBot — News & Announcements" channel.
--
-- Adds a third SINGLETON platform campaign, kind='welcome' (id 'sys_welcome'),
-- alongside the existing 'monthly_report' / 'subscription_reminder' singletons
-- (migration 0100). The welcome body is operator-editable from the Рассылки hub
-- and personalized at delivery via {salon_name} / {owner_name} / {first_name} /
-- {plan} tokens (see src/services/platformCampaignVars.js).
--
-- Phase 1 delivers it SYNCHRONOUSLY at registration (admin-app
-- deliverWelcomeFireAndForget), idempotent via the existing
-- platform_campaign_deliveries ledger (occurrence_key='once' → once per owner
-- ever). The Worker cron does NOT yet treat 'welcome' as due (isCampaignDueForTenant
-- returns NOT_DUE for it), so seeding this row active does not trigger a mass
-- backfill — that lands in Phase 2 with the empty-channel-gated cron path.
--
-- SQLite cannot ALTER a partial index in place, so the singleton-kind index is
-- dropped and recreated to admit 'welcome'. Additive otherwise — no columns or
-- tables touched.

DROP INDEX IF EXISTS idx_platform_campaigns_singleton_kind;
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_campaigns_singleton_kind
  ON platform_campaigns(kind)
  WHERE kind IN ('monthly_report', 'subscription_reminder', 'welcome');

-- Seed the welcome singleton, ACTIVE, center + bell channels. Deterministic id →
-- idempotent across deploys. bodies_json.center carries the default RU copy with
-- personalization tokens; `body` is the plain fallback.
INSERT OR IGNORE INTO platform_campaigns
  (id, kind, title, body, bodies_json, channels_json, schedule_kind, status, created_at, updated_at)
VALUES
  ('sys_welcome', 'welcome', 'Добро пожаловать в ManicBot 👋',
   'Здравствуйте, {salon_name}! Рады видеть вас на платформе ManicBot.',
   '{"center":"Здравствуйте, {salon_name}! 👋\n\nРады видеть вас на платформе ManicBot. В этом канале мы будем присылать важные новости, советы по работе с записями и клиентами, а также специальные предложения.\n\nС чего начать:\n• Добавьте услуги и мастеров\n• Подключите Telegram-бота для онлайн-записи\n• Настройте напоминания клиентам\n\nЕсли что-то непонятно — загляните в раздел «Помощь» или напишите в поддержку. Удачного старта! 💅"}',
   '["center","bell"]', 'now', 'active', unixepoch(), unixepoch());
