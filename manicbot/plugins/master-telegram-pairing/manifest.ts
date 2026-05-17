import type { PluginManifest } from "../types";

/**
 * Master Telegram Pairing — UI catalog facade over the core 0072 flow.
 *
 * The actual feature is built into core (NOT plugin-gated) — see:
 *   - migration `0072_master_telegram_pairing.sql`
 *   - worker `src/services/masterPairing.js` + `/start mst_<token>` branch
 *     in `src/handlers/message.js`
 *   - tRPC `master.requestPairingCode / getMyPairingState / unpairTelegram`
 *     + `salon.createMasterPairingCode / setMasterTelegramChatId /
 *     listMasterPairingStates`
 *   - UI `~/components/master/MasterTelegramPairingCard.tsx` (Master dashboard
 *     Profile tab) + `~/components/salon/SalonMasterPairingTable.tsx`
 *     (Salon → Channels → Telegram tab)
 *
 * This manifest is purely a marketplace discovery point — same pattern as
 * `google-calendar` (also a core-backed facade). No router / lifecycle
 * loaders, no install gating. Every tenant has the flow available; the
 * marketplace entry exists so owners can find / understand the feature.
 *
 * Why it's surfaced as a plugin per the user request: it's a discrete,
 * narrowly-scoped capability that bridges the web admin and the Telegram
 * bot — packaging it like a plugin makes it discoverable next to
 * `google-calendar`, `message-templates`, and `availability-share`.
 */
const manifest: PluginManifest = {
  slug: "master-telegram-pairing",
  version: "1.0.0",
  vendor: "manicbot",
  category: "operations",
  status: "live",
  scope: "tenant",
  icon: { name: "Send", tint: "#0ea5e9" },
  name: {
    ru: "Привязка мастеров к Telegram",
    ua: "Прив'язка майстрів до Telegram",
    en: "Master Telegram Pairing",
    pl: "Powiązanie mistrzów z Telegram",
  },
  tagline: {
    ru: "Каждый мастер работает через бота салона: уведомления, расписание, клиенты",
    ua: "Кожен майстер працює через бота салону: сповіщення, розклад, клієнти",
    en: "Every master works through the salon's bot: alerts, schedule, clients",
    pl: "Każdy mistrz pracuje przez bota salonu: powiadomienia, harmonogram, klienci",
  },
  description: {
    ru: "Сгенерируй одноразовую ссылку для мастера или введи его Telegram ID вручную. После привязки мастер получает уведомления о новых записях и работает в роли мастера: подтверждает, видит расписание и клиентов — всё прямо в Telegram-боте салона. Подходит как для созданных в админке мастеров (с синтетическим chat_id), так и для приглашённых через Telegram.",
    ua: "Згенеруй одноразове посилання для майстра або введи його Telegram ID вручну. Після прив'язки майстер отримує сповіщення про нові записи й працює в ролі майстра: підтверджує, бачить розклад і клієнтів — все прямо в Telegram-боті салону.",
    en: "Generate a one-shot deep-link for the master, or paste their Telegram ID directly. Once paired, the master receives new-booking alerts and works in master role — confirming, viewing schedule, browsing clients — all inside the salon's Telegram bot. Works for both salon-created masters (with synthetic chat_id) and Telegram-invited masters.",
    pl: "Wygeneruj jednorazowy link dla mistrza albo wklej jego Telegram ID ręcznie. Po sparowaniu mistrz otrzymuje powiadomienia o nowych rezerwacjach i pracuje w roli mistrza: potwierdza, widzi harmonogram i klientów — bezpośrednio w bocie Telegram salonu.",
  },
  keywords: {
    ru: ["telegram", "мастер", "привязка", "уведомления", "бот", "канал"],
    ua: ["telegram", "майстер", "прив'язка", "сповіщення", "бот", "канал"],
    en: ["telegram", "master", "pairing", "notifications", "bot", "channel"],
    pl: ["telegram", "mistrz", "parowanie", "powiadomienia", "bot", "kanał"],
  },
  availableForRoles: ["tenant_owner", "tenant_manager", "master"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [
    { key: "masters.read", scope: "read" },
    { key: "masters.write", scope: "write" },
  ],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
