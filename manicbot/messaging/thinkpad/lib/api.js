/**
 * api — thin client for the Worker messaging seam (/admin/messaging/*).
 *
 * The ThinkPad crons never write D1 directly; they POST to the Worker, which
 * owns the binding. Auth: Bearer MESSAGING_TOKEN (low-privilege — can only touch
 * the messaging tables). Both come from the environment (.env, gitignored).
 *
 * No secrets are ever logged. Network errors are returned, not thrown, so a
 * cron tick degrades gracefully instead of crashing PM2.
 */

const WORKER_URL = (process.env.WORKER_URL || 'https://manicbot.com').replace(/\/$/, '');
const MESSAGING_TOKEN = process.env.MESSAGING_TOKEN || '';

const TIMEOUT_MS = 15000;

async function call(method, route, body) {
  if (!MESSAGING_TOKEN) return { ok: false, error: 'MESSAGING_TOKEN_unset' };
  const url = `${WORKER_URL}/admin/messaging/${route}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${MESSAGING_TOKEN}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) return { ok: false, status: res.status, error: json?.error || `http_${res.status}` };
    return { ok: true, ...json };
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? 'timeout' : (e?.message || 'network_error') };
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  holidaysUpsert: (rows) => call('POST', 'holidays-upsert', { rows }),
  templateDraft: (tpl) => call('POST', 'template-draft', tpl),
  campaignDraft: (camp) => call('POST', 'campaign-draft', camp),
  approve: (id, status) => call('POST', 'approve', { id, status }),
  promoMint: (opts) => call('POST', 'promo-mint', opts),
  listDrafts: () => call('GET', 'drafts'),
};
