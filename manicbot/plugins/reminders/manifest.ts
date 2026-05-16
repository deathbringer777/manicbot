import type { PluginManifest } from "../types";

/**
 * Reminders & routines plugin.
 *
 * First plugin to use the Worker plugin-cron runtime (`phasePluginCron` in
 * src/handlers/cron.js). Lets staff create one-shot or recurring reminders
 * that surface as thin chips inside the day/week calendar AND fire as
 * notifications (in-app bell + optional Telegram dup) at the scheduled
 * time. The "routine" variant is the same shape with weekly recurrence
 * defaults — it is a UI affordance, not a separate domain object.
 *
 * Scope is `tenant`. Personal masters install on their own personal
 * tenant; salon owners install for the whole salon and can target
 * specific masters when creating each reminder.
 */
const manifest: PluginManifest = {
  slug: "reminders",
  version: "0.1.0",
  vendor: "manicbot",
  category: "productivity",
  status: "live",
  scope: "tenant",
  icon: { name: "Bell", tint: "#6366f1" },
  name: {
    ru: "Напоминания",
    ua: "Нагадування",
    en: "Reminders",
    pl: "Przypomnienia",
  },
  tagline: {
    ru: "Личные и циклические напоминания прямо в календарь",
    ua: "Особисті та циклічні нагадування прямо в календар",
    en: "Personal and recurring reminders right in the calendar",
    pl: "Osobiste i cykliczne przypomnienia w kalendarzu",
  },
  description: {
    ru:
      "Создавайте разовые напоминания (\"закрыть кассу в 18:00\") и рутины " +
      "(\"каждый Пн/Ср/Пт в 09:00 — обработать инструменты\"). Тонкая полоска " +
      "в колонке мастера показывает напоминание на сетке времени; в момент " +
      "срабатывания приходит уведомление в колокольчик в шапке дашборда и " +
      "опционально дублируется в Telegram.",
    ua:
      "Створюйте разові нагадування та рутини. Тонка смужка в колонці " +
      "майстра показує нагадування на сітці часу; у момент спрацювання " +
      "приходить сповіщення у дзвіночок у шапці дашборда та опціонально " +
      "дублюється в Telegram.",
    en:
      "Create one-shot reminders (\"close register at 18:00\") and routines " +
      "(\"every Mon/Wed/Fri at 09:00 — sterilize tools\"). A thin bar in the " +
      "master's column shows the reminder on the time grid; when it fires you " +
      "get a header-bell notification + optional Telegram dup.",
    pl:
      "Twórz jednorazowe przypomnienia i rutyny. Cienka linia w kolumnie " +
      "mistrza pokazuje przypomnienie na siatce czasu; w momencie wywołania " +
      "otrzymujesz powiadomienie w dzwonku nagłówka i opcjonalny duplikat " +
      "w Telegramie.",
  },
  keywords: {
    ru: ["напоминание", "рутина", "крон", "циклическое", "колокольчик"],
    ua: ["нагадування", "рутина", "крон", "циклічне", "дзвіночок"],
    en: ["reminder", "routine", "cron", "recurring", "bell"],
    pl: ["przypomnienie", "rutyna", "cron", "cykliczne", "dzwonek"],
  },
  availableForRoles: ["tenant_owner", "tenant_manager", "master"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [
    { key: "reminders.write", scope: "write" },
    { key: "notifications.write", scope: "write" },
    { key: "telegram.send", scope: "write", sensitive: true },
  ],
  capabilities: {
    cron: [{ schedule: "*/15 * * * *", handlerId: "fire" }],
    trpcSubRouter: true,
  },
  lifecycle: {},
};

export default manifest;
