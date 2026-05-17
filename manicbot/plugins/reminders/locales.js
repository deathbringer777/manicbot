/**
 * Reminders plugin — i18n strings used at runtime by cron / userNotify.
 *
 * The manifest carries marketplace-facing strings (name/tagline/description);
 * this file carries strings emitted at fire time (Telegram message templates,
 * in-app bell titles when the user provides no title — currently unused but
 * reserved for the "default Routine label" use-case).
 *
 * JS (not TS) because it is imported by the worker cron handler.
 */

export const REMINDERS_LOCALES = Object.freeze({
  ru: {
    telegramPrefix: '🔔 Напоминание',
    routinePrefix: '🔁 Рутина',
  },
  ua: {
    telegramPrefix: '🔔 Нагадування',
    routinePrefix: '🔁 Рутина',
  },
  en: {
    telegramPrefix: '🔔 Reminder',
    routinePrefix: '🔁 Routine',
  },
  pl: {
    telegramPrefix: '🔔 Przypomnienie',
    routinePrefix: '🔁 Rutyna',
  },
});

export function getReminderLocale(lang) {
  return REMINDERS_LOCALES[lang] || REMINDERS_LOCALES.ru;
}
