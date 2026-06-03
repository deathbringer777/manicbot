/**
 * Admin/ops bot — fail-closed action dispatcher.
 *
 * Mirrors the customer pipeline's `canRoleRunTag` philosophy: default-deny.
 * READ tags are idempotent and executed directly. MUTATING tags are NEVER
 * executed from a tag — they only render a confirm keyboard, so a hallucinated
 * `[OPS_RESET_WEBHOOKS]` from the model can at most surface a button. The actual
 * op runs solely from a CB.ADMINBOT_CONFIRM_* tap (handler.runConfirmedMutation).
 */
import { log } from '../utils/logger.js';
import { sendAdmin } from './reply.js';
import { mainMenuKb, confirmKb, MUTATION_CONFIRM } from './keyboards.js';
import * as mon from './monitoring.js';

/** READ tags the AI may execute directly. */
export const ADMIN_READ_TAGS = new Set([
  'STATS', 'SIGNUPS', 'APPTS', 'MRR', 'ERRORS', 'BOT_HEALTH', 'TENANT_LOOKUP', 'AI_USAGE', 'HELP', 'WHOAMI',
]);

/** MUTATING tags — recognized for confirm only, NEVER directly executable. */
export const ADMIN_MUTATING_TAGS = new Set([
  'OPS_RESET_WEBHOOKS', 'OPS_TEST_NOTIFY', 'OPS_MARKETING_TICK',
]);

/** Fail-closed: only READ tags are directly runnable. Unknown/mutating → false. */
export function canRunAdminTag(tag) {
  return typeof tag === 'string' && ADMIN_READ_TAGS.has(tag);
}

const HELP_TEXT = [
  '🛠 <b>ManicBot — админ-бот</b>',
  '',
  '<b>Команды:</b>',
  '/stats — статистика платформы',
  '/errors [severity] — лог открытых ошибок',
  '/bots — здоровье ботов (молчащие вебхуки)',
  '/tenant &lt;запрос&gt; — поиск салона',
  '/ops — операции (с подтверждением)',
  '',
  '<b>Можно писать текстом</b>, напр.: «сколько активных салонов», «ошибки за сегодня», «есть молчащие боты», «найди салон Glow».',
  'Изменяющие операции всегда требуют подтверждения кнопкой.',
].join('\n');

/**
 * Render a confirm keyboard for a mutating tag (does NOT run the op).
 * @returns {Promise<boolean>} true when handled.
 */
export async function promptMutationConfirm(ctx, cid, tag) {
  const meta = MUTATION_CONFIRM[tag];
  if (!meta) return false;
  await sendAdmin(ctx, cid, meta.warn, confirmKb(meta.confirmCb));
  return true;
}

/**
 * Execute an admin action by tag. READ tags fetch+render+send. MUTATING tags
 * surface a confirm. Anything else is denied (fail-closed).
 * @returns {Promise<boolean>} true when the action produced output.
 */
export async function executeAdminAction(ctx, cid, tag, param, from) {
  if (ADMIN_MUTATING_TAGS.has(tag)) {
    return promptMutationConfirm(ctx, cid, tag);
  }
  if (!canRunAdminTag(tag)) {
    log.warn('adminbot.dispatch', { message: 'denied admin tag (fail-closed)', tag });
    return false;
  }
  switch (tag) {
    case 'STATS': {
      const s = await mon.getPlatformStats(ctx);
      await sendAdmin(ctx, cid, mon.renderStats(s), mainMenuKb());
      return true;
    }
    case 'SIGNUPS': {
      const s = await mon.getSignups(ctx);
      await sendAdmin(ctx, cid, mon.renderSignups(s), mainMenuKb());
      return true;
    }
    case 'APPTS': {
      const s = await mon.getAppts(ctx);
      await sendAdmin(ctx, cid, mon.renderAppts(s), mainMenuKb());
      return true;
    }
    case 'MRR': {
      const s = await mon.getPlatformStats(ctx);
      await sendAdmin(ctx, cid, mon.renderMrr(s), mainMenuKb());
      return true;
    }
    case 'ERRORS': {
      const e = await mon.getErrors(ctx, String(param || '').trim());
      await sendAdmin(ctx, cid, mon.renderErrors(e), mainMenuKb());
      return true;
    }
    case 'BOT_HEALTH': {
      const b = await mon.getBotHealth(ctx);
      await sendAdmin(ctx, cid, mon.renderBotHealth(b), mainMenuKb());
      return true;
    }
    case 'TENANT_LOOKUP': {
      const r = await mon.lookupTenant(ctx, param);
      await sendAdmin(ctx, cid, mon.renderTenant(r), mainMenuKb());
      return true;
    }
    case 'AI_USAGE': {
      const u = await mon.getAiUsage(ctx);
      await sendAdmin(ctx, cid, mon.renderAiUsage(u), mainMenuKb());
      return true;
    }
    case 'HELP':
      await sendAdmin(ctx, cid, HELP_TEXT, mainMenuKb());
      return true;
    case 'WHOAMI':
      await sendAdmin(ctx, cid, `👤 Авторизован как владелец. Бот: <code>${ctx.botId || '—'}</code>.`, mainMenuKb());
      return true;
  }
  return false;
}
