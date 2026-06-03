/**
 * Admin/ops bot — slash-command catalog, inline menus, and the mutation
 * confirm wiring. All user-facing labels are Russian (the owner reads Russian);
 * code/comments are English per project standards.
 */
import { CB } from '../config.js';

/** setMyCommands payload — the slash menu shown in the admin bot. */
export const ADMIN_BOT_COMMANDS = [
  { command: 'start', description: 'Панель мониторинга' },
  { command: 'stats', description: 'Статистика платформы' },
  { command: 'errors', description: 'Лог ошибок' },
  { command: 'bots', description: 'Здоровье ботов (вебхуки)' },
  { command: 'tenant', description: 'Поиск салона: /tenant <запрос>' },
  { command: 'ops', description: 'Операции (с подтверждением)' },
  { command: 'help', description: 'Справка по командам' },
];

/** Main monitoring menu (deterministic mirror of the AI read-tags). */
export function mainMenuKb() {
  return { reply_markup: { inline_keyboard: [
    [{ text: '📊 Статы', callback_data: CB.ADMINBOT_STATS }, { text: '🆕 Сигнапы', callback_data: CB.ADMINBOT_SIGNUPS }],
    [{ text: '📅 Записи', callback_data: CB.ADMINBOT_APPTS }, { text: '💰 MRR', callback_data: CB.ADMINBOT_MRR }],
    [{ text: '🚨 Ошибки', callback_data: CB.ADMINBOT_ERRORS }, { text: '🤖 Боты', callback_data: CB.ADMINBOT_BOT_HEALTH }],
    [{ text: '📈 AI usage', callback_data: CB.ADMINBOT_AI_USAGE }, { text: '🔎 Салон', callback_data: CB.ADMINBOT_TENANT_PROMPT }],
    [{ text: '⚙️ Операции', callback_data: CB.ADMINBOT_OPS_MENU }],
  ] } };
}

/** Ops submenu — each entry triggers a two-step confirm, never a direct run. */
export function opsMenuKb() {
  return { reply_markup: { inline_keyboard: [
    [{ text: '🔁 Reset вебхуков (все боты)', callback_data: CB.ADMINBOT_OPS_RESET_WH }],
    [{ text: '🔔 Тест-нотифай себе', callback_data: CB.ADMINBOT_OPS_TEST_NOTIFY }],
    [{ text: '📣 Маркетинг-тик (IG)', callback_data: CB.ADMINBOT_OPS_MKT_TICK }],
    [{ text: '◀️ В меню', callback_data: CB.ADMINBOT_MAIN }],
  ] } };
}

/** Confirm/cancel keyboard for a mutating op. */
export function confirmKb(confirmCb) {
  return { reply_markup: { inline_keyboard: [
    [{ text: '✅ Подтвердить', callback_data: confirmCb }, { text: '✖️ Отмена', callback_data: CB.ADMINBOT_OPS_MENU }],
  ] } };
}

/**
 * Mutating tag → confirm metadata. Single source for BOTH the AI-tag path
 * (executeAdminAction renders this confirm instead of running) and the inline
 * ops menu. The actual op runs only from the matching ADMINBOT_CONFIRM_* tap.
 */
export const MUTATION_CONFIRM = {
  OPS_RESET_WEBHOOKS: { confirmCb: CB.ADMINBOT_CONFIRM_RESET_WH, warn: '⚠️ Сбросить вебхуки <b>ВСЕХ</b> клиентских ботов платформы? Это переустановит setWebhook для каждого активного бота.' },
  OPS_TEST_NOTIFY:    { confirmCb: CB.ADMINBOT_CONFIRM_TEST_NOTIFY, warn: 'Отправить тестовое уведомление себе в этот чат?' },
  OPS_MARKETING_TICK: { confirmCb: CB.ADMINBOT_CONFIRM_MKT_TICK, warn: '⚠️ Запустить один тик IG-автопилота (@manicbot_com) сейчас?' },
};

/** Ops-menu button CB → mutating tag (button reuses the same confirm path). */
export const OPS_BUTTON_TAG = {
  [CB.ADMINBOT_OPS_RESET_WH]: 'OPS_RESET_WEBHOOKS',
  [CB.ADMINBOT_OPS_TEST_NOTIFY]: 'OPS_TEST_NOTIFY',
  [CB.ADMINBOT_OPS_MKT_TICK]: 'OPS_MARKETING_TICK',
};

/** Confirm CB → mutating tag (the actual execution trigger). */
export const CONFIRM_TAG = {
  [CB.ADMINBOT_CONFIRM_RESET_WH]: 'OPS_RESET_WEBHOOKS',
  [CB.ADMINBOT_CONFIRM_TEST_NOTIFY]: 'OPS_TEST_NOTIFY',
  [CB.ADMINBOT_CONFIRM_MKT_TICK]: 'OPS_MARKETING_TICK',
};
