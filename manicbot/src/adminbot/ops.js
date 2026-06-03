/**
 * Admin/ops bot — MUTATING operations.
 *
 * SECURITY: nothing here is reachable from a free-text AI tag. The dispatcher
 * routes mutating tags to a confirm keyboard; these functions run ONLY from the
 * matching ADMINBOT_CONFIRM_* callback tap (handler.runConfirmedMutation). Each
 * op is wrapped so a failure is captured to error_events (surfaces in /errors).
 */
import { log } from '../utils/logger.js';
import { captureError } from '../utils/errorCapture.js';
import { send } from '../telegram.js';
import { listTenantIds, getBotIdsByTenantId, getBot, getBotToken } from '../tenant/storage.js';

/**
 * Re-register Telegram webhooks for ALL active client bots — reuse of the
 * /admin/reset-webhooks loop. The admin bot itself is NOT in the `bots` table,
 * so it is naturally excluded and its own webhook is left intact.
 * @returns {Promise<{count:number, ok:number, failed:string[]}>}
 */
export async function opsResetWebhooks(ctx) {
  const baseUrl = (ctx.APP_BASE_URL || 'https://manicbot.com').replace(/\/$/, '');
  let count = 0;
  let ok = 0;
  const failed = [];
  try {
    const tenantIds = await listTenantIds(ctx);
    for (const tenantId of tenantIds) {
      const botIds = await getBotIdsByTenantId(ctx, tenantId);
      for (const botId of botIds) {
        count++;
        const bot = await getBot(ctx, botId);
        const token = await getBotToken(ctx, botId, ctx.BOT_ENCRYPTION_KEY || null);
        if (!token) { failed.push(botId); continue; }
        try {
          const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: `${baseUrl}/webhook/${botId}`, secret_token: bot?.webhookSecret || '', allowed_updates: ['message', 'callback_query'] }),
            signal: AbortSignal.timeout(8000),
          });
          const data = await r.json().catch(() => ({}));
          if (data?.ok) ok++; else failed.push(botId);
        } catch (e) {
          log.error('adminbot.ops.resetWebhooks', e instanceof Error ? e : new Error(String(e?.message)), { botId });
          failed.push(botId);
        }
      }
    }
  } catch (e) {
    await captureError(ctx, e, { source: 'adminbot.ops.resetWebhooks' });
  }
  return { count, ok, failed };
}

/** Send a test notification to the owner's chat (proves the bot can deliver). */
export async function opsTestNotify(ctx) {
  try {
    const chatId = ctx.ADMIN_CHAT_ID || ctx.adminChatId;
    await send(ctx, chatId, '🔔 Тестовое уведомление от админ-бота — доставка работает ✅');
    return { ok: true };
  } catch (e) {
    await captureError(ctx, e, { source: 'adminbot.ops.testNotify' });
    return { ok: false, error: e?.message || 'failed' };
  }
}

/** Kick one IG autopilot tick (reuse of /admin/marketing-tick). */
export async function opsMarketingTick(ctx) {
  try {
    const { phaseInstagramAutopilot } = await import('../marketing/autopilot.js');
    const result = await phaseInstagramAutopilot(ctx);
    return { ok: true, ...result };
  } catch (e) {
    await captureError(ctx, e, { source: 'adminbot.ops.marketingTick' });
    return { ok: false, error: e?.message || 'failed' };
  }
}
