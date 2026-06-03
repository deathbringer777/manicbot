/**
 * Admin/ops bot reply helper — chunked send.
 *
 * Long monitoring reports (error lists, bot-health, stats) can exceed
 * Telegram's 4096-char limit, so split via the shared splitTelegramText util
 * and attach the inline keyboard (if any) only to the LAST chunk.
 */
import { send } from '../telegram.js';
import { splitTelegramText } from '../utils/telegramChunk.js';

/**
 * @param {any} ctx admin bot ctx (channel:null → Telegram)
 * @param {number|string} cid chat id (the owner)
 * @param {string} text HTML-safe text (parse_mode HTML is applied by send)
 * @param {object} [extra] Telegram extra (e.g. { reply_markup })
 */
export async function sendAdmin(ctx, cid, text, extra = {}) {
  const chunks = splitTelegramText(text, 3500);
  if (chunks.length === 0) return;
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    await send(ctx, cid, chunks[i], isLast ? extra : {});
  }
}
