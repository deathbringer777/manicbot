import { send } from '../telegram.js';
import { t } from '../utils/helpers.js';
import { CB } from '../config.js';
import { stampEmailPrompt } from '../services/marketing/contacts.js';

/**
 * Show the "leave your email" ask with inline Yes/No buttons and stamp the
 * anti-nag cooldown (so we don't re-ask too soon or too often). Tapping Yes
 * (CB.EMAIL_YES) moves the user into STEP.EMAIL_WAIT in the callback handler;
 * the next text they send is parsed as the email by onMsg.
 *
 * Channel-agnostic — the web widget renders callback_data buttons natively, so
 * the same ask works on Telegram, WhatsApp, Instagram and web.
 */
export async function askEmail(ctx, cid, lg) {
  await stampEmailPrompt(ctx, cid).catch(() => {});
  return send(ctx, cid, t(lg, 'email_ask'), {
    reply_markup: {
      inline_keyboard: [
        [{ text: t(lg, 'email_ask_btn'), callback_data: CB.EMAIL_YES }],
        [{ text: t(lg, 'email_decline_btn'), callback_data: CB.EMAIL_NO }],
      ],
    },
  });
}
