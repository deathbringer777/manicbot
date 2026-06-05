-- 0112_drop_reminders_tables.sql — 2026-06-06
--
-- Remove the `reminders` marketplace plugin's tables. The plugin was dropped
-- because it duplicated system-level capability: the in-app notification bell
-- (user_notifications) plus the core `phaseReminders` appointment-reminder cron.
-- Its calendar-chip UI was never wired.
--
-- user_notifications is KEPT — it is the platform-wide bell feed written by
-- appointments / billing / channel-health / platform-campaigns / support, NOT
-- reminders-specific. Only the two reminders-only tables are dropped here.
--
-- plugin_reminder_fires has an ON DELETE CASCADE FK into plugin_reminders, so
-- drop the child first. Orphaned `plugin_installations` rows with
-- plugin_slug='reminders' are harmless (every consumer null-guards unknown
-- slugs via getPlugin) and are left in place.

DROP TABLE IF EXISTS plugin_reminder_fires;
DROP TABLE IF EXISTS plugin_reminders;
