/**
 * Admin/ops bot — message + callback entry points.
 *
 * SECURITY (fail-closed, owner-only): the bot is reachable by anyone who finds
 * its @username, so every update is gated by isAdminAuthorized() FIRST. A
 * non-owner is silently dropped (we don't reveal the bot's purpose). This is
 * independent of and additional to the webhook secret-token check in
 * tryTelegramWebhook and the dispatcher's fail-closed tag gate.
 */
import { CB, STEP } from '../config.js';
import { log } from '../utils/logger.js';
import { isCreator } from '../services/users.js';
import { timingSafeEqual } from '../utils/security.js';
import { answerCb } from '../telegram.js';
import { escHtml } from '../utils/helpers.js';
import { getChatHistory, appendChatTurn } from '../services/chat.js';
import { getState, setState, clearState } from '../services/state.js';
import { parseAIActions } from '../ai.js';
import { runAdminAI } from './ai.js';
import { executeAdminAction, promptMutationConfirm } from './dispatcher.js';
import { opsResetWebhooks, opsTestNotify, opsMarketingTick } from './ops.js';
import { sendAdmin } from './reply.js';
import { mainMenuKb, opsMenuKb, OPS_BUTTON_TAG, CONFIRM_TAG } from './keyboards.js';

const BANNER = '🛠 <b>ManicBot — панель мониторинга</b>\nВыбери раздел или напиши вопрос текстом.';

/**
 * Owner-only authorization. True for the platform creator (ADMIN_CHAT_ID) or an
 * id explicitly listed in ADMIN_BOT_ALLOWED_IDS (timing-safe compare).
 */
export function isAdminAuthorized(ctx, fromId) {
  if (fromId == null) return false;
  if (isCreator(ctx, fromId)) return true;
  const ids = String(ctx.ADMIN_BOT_ALLOWED_IDS || '').split(/[,\s]+/).filter(Boolean);
  return ids.some((id) => timingSafeEqual(String(fromId), id));
}

export async function onAdminMsg(ctx, msg) {
  const from = msg?.from;
  const cid = msg?.chat?.id;
  if (!isAdminAuthorized(ctx, from?.id)) {
    log.warn('adminbot', { message: 'unauthorized admin-bot message dropped', fromId: from?.id ?? null });
    return; // silent drop
  }
  const txt = String(msg.text || '').trim();

  // Pending tenant search (after the 🔎 button)?
  const st = await getState(ctx, cid);
  if (st?.step === STEP.ADMINBOT_TENANT_QUERY && txt && !txt.startsWith('/')) {
    await clearState(ctx, cid);
    await executeAdminAction(ctx, cid, 'TENANT_LOOKUP', txt, from);
    return;
  }

  if (txt.startsWith('/')) return handleAdminCommand(ctx, cid, txt, from);
  if (!txt) return; // ignore non-text (photos, stickers, etc.)
  return handleAdminFreeText(ctx, cid, from, txt);
}

export async function onAdminCb(ctx, cb) {
  const from = cb?.from;
  const cid = cb?.message?.chat?.id;
  const d = cb?.data;
  if (!isAdminAuthorized(ctx, from?.id)) {
    try { await answerCb(ctx, cb.id, ''); } catch { /* best-effort */ }
    log.warn('adminbot', { message: 'unauthorized admin-bot callback dropped', fromId: from?.id ?? null });
    return;
  }
  try { await answerCb(ctx, cb.id); } catch { /* best-effort */ }

  switch (d) {
    case CB.ADMINBOT_MAIN: return sendAdmin(ctx, cid, BANNER, mainMenuKb());
    case CB.ADMINBOT_STATS: return void (await executeAdminAction(ctx, cid, 'STATS', '', from));
    case CB.ADMINBOT_SIGNUPS: return void (await executeAdminAction(ctx, cid, 'SIGNUPS', '', from));
    case CB.ADMINBOT_APPTS: return void (await executeAdminAction(ctx, cid, 'APPTS', '', from));
    case CB.ADMINBOT_MRR: return void (await executeAdminAction(ctx, cid, 'MRR', '', from));
    case CB.ADMINBOT_ERRORS: return void (await executeAdminAction(ctx, cid, 'ERRORS', '', from));
    case CB.ADMINBOT_BOT_HEALTH: return void (await executeAdminAction(ctx, cid, 'BOT_HEALTH', '', from));
    case CB.ADMINBOT_AI_USAGE: return void (await executeAdminAction(ctx, cid, 'AI_USAGE', '', from));
    case CB.ADMINBOT_TENANT_PROMPT:
      await setState(ctx, cid, { step: STEP.ADMINBOT_TENANT_QUERY });
      return sendAdmin(ctx, cid, '🔎 Введи название, slug или id салона:');
    case CB.ADMINBOT_OPS_MENU: return sendAdmin(ctx, cid, '⚙️ Операции (требуют подтверждения):', opsMenuKb());
  }
  // Ops button → confirm prompt (never executes directly).
  if (OPS_BUTTON_TAG[d]) return void (await promptMutationConfirm(ctx, cid, OPS_BUTTON_TAG[d]));
  // Confirm tap → run the mutation.
  if (CONFIRM_TAG[d]) return runConfirmedMutation(ctx, cid, CONFIRM_TAG[d]);
}

async function handleAdminCommand(ctx, cid, txt, from) {
  const [cmd, ...rest] = txt.split(/\s+/);
  const arg = rest.join(' ').trim();
  switch (cmd) {
    case '/start':
    case '/menu':
      return sendAdmin(ctx, cid, BANNER, mainMenuKb());
    case '/help': return void (await executeAdminAction(ctx, cid, 'HELP', '', from));
    case '/stats': return void (await executeAdminAction(ctx, cid, 'STATS', '', from));
    case '/errors': return void (await executeAdminAction(ctx, cid, 'ERRORS', arg, from));
    case '/bots': return void (await executeAdminAction(ctx, cid, 'BOT_HEALTH', '', from));
    case '/ops': return sendAdmin(ctx, cid, '⚙️ Операции (требуют подтверждения):', opsMenuKb());
    case '/tenant':
      if (!arg) {
        await setState(ctx, cid, { step: STEP.ADMINBOT_TENANT_QUERY });
        return sendAdmin(ctx, cid, '🔎 Введи название, slug или id салона:');
      }
      return void (await executeAdminAction(ctx, cid, 'TENANT_LOOKUP', arg, from));
    default:
      return sendAdmin(ctx, cid, 'Неизвестная команда. Открой /start или напиши вопрос текстом.', mainMenuKb());
  }
}

async function handleAdminFreeText(ctx, cid, from, txt) {
  const history = await getChatHistory(ctx, cid);
  const reply = await runAdminAI(ctx, txt, history);
  if (!reply) {
    await sendAdmin(ctx, cid, '⚠️ Нейронка сейчас недоступна — используй кнопки.', mainMenuKb());
    return;
  }
  const { text, actions } = parseAIActions(reply);
  let acted = false;
  for (const a of actions) {
    const ok = await executeAdminAction(ctx, cid, a.tag, a.param, from);
    acted = acted || ok;
  }
  if (text) {
    // Plain assistant prose — escape (send applies parse_mode HTML). Attach the
    // menu only when no action already sent its own report.
    await sendAdmin(ctx, cid, escHtml(text), acted ? {} : mainMenuKb());
  } else if (!acted) {
    await sendAdmin(ctx, cid, 'Не понял запрос. Открой /start или уточни.', mainMenuKb());
  }
  await appendChatTurn(ctx, cid, txt, text || '');
}

async function runConfirmedMutation(ctx, cid, tag) {
  if (tag === 'OPS_RESET_WEBHOOKS') {
    const r = await opsResetWebhooks(ctx);
    const fail = r.failed.length ? `\n⚠️ Не удалось: ${escHtml(r.failed.join(', ').slice(0, 500))}` : '';
    return sendAdmin(ctx, cid, `🔁 Reset вебхуков: ${r.ok}/${r.count} ok${fail}`, mainMenuKb());
  }
  if (tag === 'OPS_TEST_NOTIFY') {
    const r = await opsTestNotify(ctx);
    return sendAdmin(ctx, cid, r.ok ? '🔔 Отправлено.' : `❌ Ошибка: ${escHtml(String(r.error || ''))}`, mainMenuKb());
  }
  if (tag === 'OPS_MARKETING_TICK') {
    const r = await opsMarketingTick(ctx);
    return sendAdmin(ctx, cid, `📣 Маркетинг-тик: <code>${escHtml(JSON.stringify(r).slice(0, 600))}</code>`, mainMenuKb());
  }
}
