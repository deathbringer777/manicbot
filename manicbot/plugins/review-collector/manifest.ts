import type { PluginManifest } from "../types";

/**
 * Review Collector — Variant A plugin #2 (post the loyalty-stamps rebuild).
 *
 * Story: after a client rates 4★ or 5★ on the internal post-visit prompt
 * (handled by the existing `rev:` callback in worker/handlers/callback.js),
 * the worker checks if this plugin is installed for the tenant and — if so —
 * appends a "leave us a Google / Yandex review" CTA to the thank-you message.
 *
 * Settings (stored in plugin_installations.settings_json):
 *   - googleReviewUrl   : string  (full link to the salon's Google Business
 *                                  review prompt, e.g. https://g.page/r/...)
 *   - yandexReviewUrl   : string  (Yandex Maps review link, optional)
 *   - customMessage     : string  (Russian by default, 0..280 chars; uses
 *                                  the localized fallback when empty)
 *
 * Free, no Stripe wiring, no migrations — fits cleanly on the existing
 * plugin contract validated by the loyalty-stamps reference.
 */
const manifest: PluginManifest = {
  slug: "review-collector",
  version: "1.0.0",
  vendor: "manicbot",
  category: "growth",
  status: "live",
  scope: "tenant",
  icon: { name: "MessageCircleHeart", tint: "#10b981" },
  name: {
    ru: "Сборщик отзывов",
    ua: "Збирач відгуків",
    en: "Review Collector",
    pl: "Zbieracz opinii",
  },
  tagline: {
    ru: "После 5⭐ клиент видит ссылку на Google-отзыв одним кликом",
    ua: "Після 5⭐ клієнт бачить посилання на Google-відгук одним кліком",
    en: "After a 5★ rating, the client sees a one-tap Google review link",
    pl: "Po 5★ klient widzi link do recenzji Google jednym kliknięciem",
  },
  description: {
    ru: "Когда клиент ставит 4 или 5 звёзд через стандартный пост-визит, бот следом отправляет приглашение оставить публичный отзыв в Google или Яндексе. Только довольные клиенты — рейтинг растёт быстрее, чем органически.",
    ua: "Коли клієнт ставить 4 або 5 зірок у пост-візиті, бот відправляє запрошення залишити публічний відгук у Google або Яндексі. Тільки задоволені клієнти — рейтинг росте швидше за органіку.",
    en: "When a client rates 4 or 5 stars in the post-visit prompt, the bot follows up with a public-review invite to Google or Yandex. Only happy clients see the prompt — your rating grows faster than organic.",
    pl: "Gdy klient da 4 lub 5 gwiazdek w prompcie po wizycie, bot wysyła zaproszenie do publicznej recenzji na Google lub Yandex. Tylko zadowoleni klienci widzą prompt — ocena rośnie szybciej niż organicznie.",
  },
  keywords: {
    ru: ["отзывы", "google", "яндекс", "репутация", "оценка"],
    ua: ["відгуки", "google", "яндекс", "репутація", "оцінка"],
    en: ["reviews", "google", "yandex", "reputation", "rating"],
    pl: ["opinie", "google", "yandex", "reputacja", "ocena"],
  },
  availableForRoles: ["tenant_owner", "tenant_manager", "master"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [{ key: "reviews.read", scope: "read" }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
