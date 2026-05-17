/**
 * Static localised copy for /register OG/Twitter metadata.
 *
 * Consumed by `generateMetadata` in the sibling `page.tsx` to emit
 * messenger-preview metadata in the inviter's UI language (passed via
 * `?lang=ru|ua|en|pl`). Pure static strings — no DB calls in metadata
 * generation, so we avoid the `validateCode` IP rate-limit (10/min) that
 * would otherwise be hammered by datacenter-IP messenger preview fetchers
 * (Telegram, WhatsApp, Slack, iMessage).
 *
 * `descriptionWithRef` is used when `?ref=` is present — slightly warmer
 * "a friend invited you" framing.
 */

export type RegisterPageLang = "ru" | "ua" | "en" | "pl";

export interface RegisterPageCopy {
  title: string;
  description: string;
  descriptionWithRef: string;
  keywords: string[];
}

export const registerPageCopy: Record<RegisterPageLang, RegisterPageCopy> = {
  ru: {
    title: "ManicBot — онлайн-запись клиентов в Telegram, WhatsApp, Instagram",
    description:
      "ManicBot — бот для записи клиентов в Telegram, WhatsApp и Instagram. Напоминания, синхронизация с Google Calendar, AI-ассистент. Регистрация — 1 минута, первый месяц со скидкой 20%.",
    descriptionWithRef:
      "Друг приглашает вас в ManicBot — бот для записи клиентов в Telegram/WhatsApp/Instagram. По реферальной ссылке — 20% off первого месяца или 10% off годовой подписки.",
    keywords: [
      "ManicBot",
      "запись клиентов",
      "онлайн-запись",
      "бот для салона",
      "маникюр",
      "регистрация",
    ],
  },
  ua: {
    title: "ManicBot — онлайн-запис клієнтів у Telegram, WhatsApp, Instagram",
    description:
      "ManicBot — бот для запису клієнтів у Telegram, WhatsApp та Instagram. Нагадування, синхронізація з Google Calendar, AI-асистент. Реєстрація — 1 хвилина, перший місяць зі знижкою 20%.",
    descriptionWithRef:
      "Друг запрошує вас у ManicBot — бот для запису клієнтів у Telegram/WhatsApp/Instagram. За реферальним посиланням — 20% off першого місяця або 10% off річної підписки.",
    keywords: [
      "ManicBot",
      "запис клієнтів",
      "онлайн-запис",
      "бот для салону",
      "манікюр",
      "реєстрація",
    ],
  },
  en: {
    title: "ManicBot — online booking for nail salons in Telegram, WhatsApp, Instagram",
    description:
      "ManicBot — booking bot for nail salons across Telegram, WhatsApp and Instagram. Reminders, Google Calendar sync, AI assistant. Sign up in a minute — 20% off your first month.",
    descriptionWithRef:
      "A friend invited you to ManicBot — the booking bot for salons in Telegram/WhatsApp/Instagram. Their referral gets you 20% off your first month or 10% off the annual plan.",
    keywords: [
      "ManicBot",
      "salon booking",
      "online booking",
      "Telegram bot",
      "nail salon",
      "sign up",
    ],
  },
  pl: {
    title: "ManicBot — rezerwacje online dla salonów paznokci w Telegram, WhatsApp, Instagram",
    description:
      "ManicBot — bot do rezerwacji online dla salonów paznokci w Telegram, WhatsApp i Instagram. Przypomnienia, synchronizacja z Google Calendar, asystent AI. Rejestracja w minutę — 20% zniżki w pierwszym miesiącu.",
    descriptionWithRef:
      "Znajomy zaprasza Cię do ManicBota — bota do rezerwacji w Telegram/WhatsApp/Instagram. Z polecenia dostajesz 20% zniżki w pierwszym miesiącu lub 10% zniżki rocznie.",
    keywords: [
      "ManicBot",
      "rezerwacje online",
      "salon paznokci",
      "bot Telegram",
      "manicure",
      "rejestracja",
    ],
  },
};

const ALLOWED: readonly RegisterPageLang[] = ["ru", "ua", "en", "pl"] as const;

/**
 * Coerce a raw `?lang=` query value to a supported language. Falls back to
 * `ru` (current dominant audience) for missing / unknown values, matching
 * the LangContext priority.
 */
export function coerceRegisterLang(raw: string | string[] | null | undefined): RegisterPageLang {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return "ru";
  const lower = String(v).toLowerCase();
  return (ALLOWED as readonly string[]).includes(lower) ? (lower as RegisterPageLang) : "ru";
}
