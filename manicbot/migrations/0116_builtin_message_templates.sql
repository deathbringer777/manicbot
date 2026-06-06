-- 0116_builtin_message_templates.sql — 2026-06-06
--
-- Phase 2 of the "ManicBot — News & Announcements" channel: seed a starter
-- library of operator → salon-owner message templates into
-- platform_message_templates (the Рассылки hub surfaces them; «В композер»
-- lifts one into the announcement composer).
--
-- All rows is_builtin=1 → the router's templateUpdate/templateDelete reject
-- mutations on them ('builtin_readonly'), so they are safe, read-only starters.
-- Bodies carry personalization tokens ({salon_name} / {owner_name} /
-- {first_name} / {plan}) substituted at delivery by platformCampaignVars.
-- Deterministic ids + INSERT OR IGNORE → idempotent across deploys. Additive
-- only; no schema change.

INSERT OR IGNORE INTO platform_message_templates
  (id, name, category, channels_json, bodies_json, locale, is_builtin, created_by, created_at, updated_at)
VALUES
  ('pmt_builtin_welcome_short', 'Короткое приветствие', 'welcome',
   '["center","bell"]',
   '{"center":"Привет, {salon_name}! 👋 Рады видеть вас в ManicBot. Если возникнут вопросы — мы всегда на связи в этом канале."}',
   'ru', 1, NULL, unixepoch(), unixepoch()),

  ('pmt_builtin_new_year', 'С Новым годом', 'seasonal',
   '["center","bell"]',
   '{"center":"С наступающим Новым годом, {salon_name}! 🎄 Спасибо, что были с нами в этом году. Желаем вашему салону полного расписания и довольных клиентов в новом году! ✨"}',
   'ru', 1, NULL, unixepoch(), unixepoch()),

  ('pmt_builtin_8_march', 'С 8 Марта', 'seasonal',
   '["center","bell"]',
   '{"center":"С 8 Марта, {salon_name}! 💐 Спасибо, что каждый день делаете мир красивее. Пусть праздничные дни принесут вам много записей и улыбок!"}',
   'ru', 1, NULL, unixepoch(), unixepoch()),

  ('pmt_builtin_plan_upgrade', 'Апгрейд тарифа', 'promo',
   '["center","bell","email"]',
   '{"center":"{first_name}, ваш салон растёт 📈 На тарифах Pro и Max доступны онлайн-запись 24/7, напоминания клиентам и аналитика. Загляните в раздел «Подписка» — возможно, пора расти вместе с нами."}',
   'ru', 1, NULL, unixepoch(), unixepoch()),

  ('pmt_builtin_referral', 'Приведи друга', 'promo',
   '["center","bell"]',
   '{"center":"Знаете коллегу со своим салоном? 🤝 Пригласите его в ManicBot по реферальной ссылке из настроек профиля — и оба получите бонус к подписке."}',
   'ru', 1, NULL, unixepoch(), unixepoch()),

  ('pmt_builtin_tip_reminders', 'Совет: напоминания', 'educational',
   '["center","bell"]',
   '{"center":"Совет дня 💡 Автоматические напоминания клиентам снижают неявки на 30–40%. Включить их можно в разделе «Напоминания» — пара минут, а эффект сразу."}',
   'ru', 1, NULL, unixepoch(), unixepoch()),

  ('pmt_builtin_tip_booking', 'Совет: онлайн-запись', 'educational',
   '["center","bell"]',
   '{"center":"Знаете ли вы? 📱 Клиенты записываются охотнее, когда сами видят свободные окна. Добавьте ссылку на онлайн-запись в шапку Instagram салона {salon_name} — записи пойдут на автопилоте."}',
   'ru', 1, NULL, unixepoch(), unixepoch());
