/**
 * platformCampaignEmail — Resend HTTP transport for the email channel of
 * platform campaigns. Mirrors the billing email pattern
 * (src/billing/notificationEmails.js): fire one POST, never throw, return
 * { ok, error }. The caller passes an already-rendered { to, subject, html }.
 *
 * Reads ctx.resendApiKey / ctx.resendFrom (set by envCtx) with a fallback to
 * the raw env vars RESEND_API_KEY / RESEND_FROM (present on the cron ctx via
 * baseCtx's `...env` spread).
 */

import { log } from '../utils/logger.js';

const RESEND_API = 'https://api.resend.com/emails';

function resendCreds(ctx) {
  return {
    key: ctx?.resendApiKey || ctx?.RESEND_API_KEY || null,
    from: ctx?.resendFrom || ctx?.RESEND_FROM || null,
  };
}

/**
 * Send one email via Resend.
 * @param {object} ctx
 * @param {{to:string, subject:string, html:string, headers?:object}} msg
 * @returns {Promise<{ok:boolean, error:string|null}>}
 */
export async function deliverEmail(ctx, msg) {
  const { key, from } = resendCreds(ctx);
  if (!key || !from) return { ok: false, error: 'resend_unconfigured' };
  if (!msg?.to || !msg?.subject || !msg?.html) return { ok: false, error: 'missing_fields' };

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        ...(msg.headers ? { headers: msg.headers } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log.error('platform.campaign.email', new Error(`Resend ${res.status}`), {
        status: res.status, body: body.slice(0, 200),
      });
      return { ok: false, error: `resend_${res.status}` };
    }
    return { ok: true, error: null };
  } catch (e) {
    log.error('platform.campaign.email', e instanceof Error ? e : new Error(String(e?.message)));
    return { ok: false, error: String(e?.message ?? 'fetch_failed') };
  }
}
