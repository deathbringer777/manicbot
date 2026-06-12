-- 0121_seed_reactive_templates.sql — 2026-06-12
--
-- Seed the reactive (system/billing) starter templates for the messaging
-- service: 5 kinds × 4 locales (RU/UA/EN/PL) = 20 rows. These are the content
-- the Worker reactive engine (src/services/reactiveMessaging.js) resolves by
-- template_key when a Stripe webhook fires; the tenant's locale is picked with an
-- EN fallback. All is_builtin=1 + status='approved' (trusted, read-only,
-- immediately deliverable — but real send is still globally gated by
-- MESSAGING_SEND_ENABLED). Deterministic ids + INSERT OR IGNORE → idempotent.
--
-- Personalization tokens are limited to {salon_name}/{first_name}/{plan}, the
-- ones the webhook wiring always passes, so the engine's declared-variable hard
-- fail never trips in production. The ThinkPad preset-generator later adds the
-- behavioral + seasonal library as drafts.

-- sys_payment_failed
INSERT OR IGNORE INTO platform_message_templates
  (id, name, category, channels_json, bodies_json, locale, is_builtin, status, template_key, variables_json, created_at, updated_at)
VALUES
  ('pmt_rx_payment_failed_ru', 'Платёж не прошёл', 'billing', '["center","bell"]',
   '{"center":"{salon_name}, оплата подписки не прошла. Обновите карту в разделе «Настройки → Биллинг» до конца grace-периода, чтобы салон продолжил работу без перерыва."}',
   'ru', 1, 'approved', 'sys_payment_failed', '["salon_name"]', unixepoch(), unixepoch()),
  ('pmt_rx_payment_failed_ua', 'Платіж не пройшов', 'billing', '["center","bell"]',
   '{"center":"{salon_name}, оплата підписки не пройшла. Оновіть картку в розділі «Налаштування → Білінг» до кінця grace-періоду, щоб салон працював без перерви."}',
   'ua', 1, 'approved', 'sys_payment_failed', '["salon_name"]', unixepoch(), unixepoch()),
  ('pmt_rx_payment_failed_en', 'Payment failed', 'billing', '["center","bell"]',
   '{"center":"{salon_name}, your subscription payment failed. Please update your card under Settings → Billing before the grace period ends so your salon keeps running."}',
   'en', 1, 'approved', 'sys_payment_failed', '["salon_name"]', unixepoch(), unixepoch()),
  ('pmt_rx_payment_failed_pl', 'Płatność nieudana', 'billing', '["center","bell"]',
   '{"center":"{salon_name}, płatność za subskrypcję nie powiodła się. Zaktualizuj kartę w sekcji „Ustawienia → Rozliczenia” przed końcem okresu karencji, aby salon działał bez przerwy."}',
   'pl', 1, 'approved', 'sys_payment_failed', '["salon_name"]', unixepoch(), unixepoch());

-- sys_payment_success
INSERT OR IGNORE INTO platform_message_templates
  (id, name, category, channels_json, bodies_json, locale, is_builtin, status, template_key, variables_json, created_at, updated_at)
VALUES
  ('pmt_rx_payment_success_ru', 'Оплата прошла', 'billing', '["center","bell"]',
   '{"center":"Спасибо, {salon_name}! Оплата прошла успешно, подписка активна. Хорошей работы и полного расписания! 💅"}',
   'ru', 1, 'approved', 'sys_payment_success', '["salon_name"]', unixepoch(), unixepoch()),
  ('pmt_rx_payment_success_ua', 'Оплата пройшла', 'billing', '["center","bell"]',
   '{"center":"Дякуємо, {salon_name}! Оплата пройшла успішно, підписка активна. Гарної роботи та повного розкладу! 💅"}',
   'ua', 1, 'approved', 'sys_payment_success', '["salon_name"]', unixepoch(), unixepoch()),
  ('pmt_rx_payment_success_en', 'Payment received', 'billing', '["center","bell"]',
   '{"center":"Thank you, {salon_name}! Your payment went through and your subscription is active. Wishing you a full schedule! 💅"}',
   'en', 1, 'approved', 'sys_payment_success', '["salon_name"]', unixepoch(), unixepoch()),
  ('pmt_rx_payment_success_pl', 'Płatność otrzymana', 'billing', '["center","bell"]',
   '{"center":"Dziękujemy, {salon_name}! Płatność przeszła pomyślnie, subskrypcja jest aktywna. Życzymy pełnego grafiku! 💅"}',
   'pl', 1, 'approved', 'sys_payment_success', '["salon_name"]', unixepoch(), unixepoch());

-- sys_trial_ending
INSERT OR IGNORE INTO platform_message_templates
  (id, name, category, channels_json, bodies_json, locale, is_builtin, status, template_key, variables_json, created_at, updated_at)
VALUES
  ('pmt_rx_trial_ending_ru', 'Триал заканчивается', 'billing', '["center","bell"]',
   '{"center":"{salon_name}, через 3 дня заканчивается пробный период. Выберите план в разделе «Настройки → Биллинг», чтобы салон продолжил работу без перерыва."}',
   'ru', 1, 'approved', 'sys_trial_ending', '["salon_name"]', unixepoch(), unixepoch()),
  ('pmt_rx_trial_ending_ua', 'Тріал закінчується', 'billing', '["center","bell"]',
   '{"center":"{salon_name}, за 3 дні закінчується пробний період. Оберіть план у розділі «Налаштування → Білінг», щоб салон працював без перерви."}',
   'ua', 1, 'approved', 'sys_trial_ending', '["salon_name"]', unixepoch(), unixepoch()),
  ('pmt_rx_trial_ending_en', 'Trial ending soon', 'billing', '["center","bell"]',
   '{"center":"{salon_name}, your free trial ends in 3 days. Choose a plan under Settings → Billing so your salon keeps running without a break."}',
   'en', 1, 'approved', 'sys_trial_ending', '["salon_name"]', unixepoch(), unixepoch()),
  ('pmt_rx_trial_ending_pl', 'Okres próbny kończy się', 'billing', '["center","bell"]',
   '{"center":"{salon_name}, Twój okres próbny kończy się za 3 dni. Wybierz plan w sekcji „Ustawienia → Rozliczenia”, aby salon działał bez przerwy."}',
   'pl', 1, 'approved', 'sys_trial_ending', '["salon_name"]', unixepoch(), unixepoch());

-- sys_plan_changed
INSERT OR IGNORE INTO platform_message_templates
  (id, name, category, channels_json, bodies_json, locale, is_builtin, status, template_key, variables_json, created_at, updated_at)
VALUES
  ('pmt_rx_plan_changed_ru', 'Тариф обновлён', 'billing', '["center","bell"]',
   '{"center":"{salon_name}, ваш тариф обновлён до «{plan}». Новые возможности уже доступны в кабинете — загляните в раздел «Подписка»."}',
   'ru', 1, 'approved', 'sys_plan_changed', '["salon_name","plan"]', unixepoch(), unixepoch()),
  ('pmt_rx_plan_changed_ua', 'Тариф оновлено', 'billing', '["center","bell"]',
   '{"center":"{salon_name}, ваш тариф оновлено до «{plan}». Нові можливості вже доступні в кабінеті — загляньте в розділ «Підписка»."}',
   'ua', 1, 'approved', 'sys_plan_changed', '["salon_name","plan"]', unixepoch(), unixepoch()),
  ('pmt_rx_plan_changed_en', 'Plan updated', 'billing', '["center","bell"]',
   '{"center":"{salon_name}, your plan is now «{plan}». The new features are live in your dashboard — check the Subscription section."}',
   'en', 1, 'approved', 'sys_plan_changed', '["salon_name","plan"]', unixepoch(), unixepoch()),
  ('pmt_rx_plan_changed_pl', 'Plan zaktualizowany', 'billing', '["center","bell"]',
   '{"center":"{salon_name}, Twój plan to teraz „{plan}”. Nowe funkcje są już dostępne w panelu — sprawdź sekcję „Subskrypcja”."}',
   'pl', 1, 'approved', 'sys_plan_changed', '["salon_name","plan"]', unixepoch(), unixepoch());

-- sys_subscription_expired
INSERT OR IGNORE INTO platform_message_templates
  (id, name, category, channels_json, bodies_json, locale, is_builtin, status, template_key, variables_json, created_at, updated_at)
VALUES
  ('pmt_rx_sub_expired_ru', 'Подписка завершена', 'billing', '["center","bell"]',
   '{"center":"{salon_name}, подписка завершена. Продлите её в разделе «Настройки → Биллинг», чтобы вернуть онлайн-запись, напоминания и аналитику."}',
   'ru', 1, 'approved', 'sys_subscription_expired', '["salon_name"]', unixepoch(), unixepoch()),
  ('pmt_rx_sub_expired_ua', 'Підписку завершено', 'billing', '["center","bell"]',
   '{"center":"{salon_name}, підписку завершено. Поновіть її в розділі «Налаштування → Білінг», щоб повернути онлайн-запис, нагадування та аналітику."}',
   'ua', 1, 'approved', 'sys_subscription_expired', '["salon_name"]', unixepoch(), unixepoch()),
  ('pmt_rx_sub_expired_en', 'Subscription ended', 'billing', '["center","bell"]',
   '{"center":"{salon_name}, your subscription has ended. Renew it under Settings → Billing to bring back online booking, reminders and analytics."}',
   'en', 1, 'approved', 'sys_subscription_expired', '["salon_name"]', unixepoch(), unixepoch()),
  ('pmt_rx_sub_expired_pl', 'Subskrypcja zakończona', 'billing', '["center","bell"]',
   '{"center":"{salon_name}, Twoja subskrypcja wygasła. Odnów ją w sekcji „Ustawienia → Rozliczenia”, aby przywrócić rezerwacje online, przypomnienia i analitykę."}',
   'pl', 1, 'approved', 'sys_subscription_expired', '["salon_name"]', unixepoch(), unixepoch());
