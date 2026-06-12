/**
 * Worker-side marketing campaign sender.
 *
 * Mirror of `admin-app/src/server/marketing/sender.ts` but operates on raw
 * D1 (via `dbGet/dbAll/dbRun` helpers) and uses `fetch()` to call Resend /
 * Brevo directly — admin-app's Drizzle stack isn't available here.
 *
 * Both implementations:
 *   - Lock the campaign by flipping status to `sending`.
 *   - Resolve audience (segment filter_json subset).
 *   - For each contact: render template, INSERT marketing_sends queued
 *     row, call provider, UPDATE to sent/failed.
 *   - Finalize campaign status (sent/failed) with stats_json.
 *
 * Hard cap: 500 inline. Overflows leave campaign status='sending' so the
 * next cron tick continues. Both sides converge on the same contract.
 */

import { dbAll, dbGet, dbRun } from '../../utils/db.js';
import { log } from '../../utils/logger.js';

const INLINE_CAP = 500;

const UNSUB_COPY = {
  ru: 'Если вы больше не хотите получать письма — отписаться',
  ua: 'Якщо ви більше не бажаєте отримувати листи — відписатися',
  en: 'If you no longer want to receive emails — unsubscribe',
  pl: 'Jeśli nie chcesz już otrzymywać e-maili — wypisz się',
};

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function rid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function publicOrigin(ctx) {
  const v = (ctx?.WORKER_PUBLIC_URL || '').trim();
  return v ? v.replace(/\/+$/, '') : 'https://manicbot.com';
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripTags(s) {
  return String(s ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"');
}

function substitute(input, vars) {
  return String(input ?? '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, name) => {
    const v = vars[name.toLowerCase()];
    return v == null ? '' : String(v);
  });
}

function firstName(name) {
  if (!name) return '';
  const trimmed = String(name).trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0] ?? '';
}

function generateToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

async function ensureUnsubscribeToken(ctx, contactId, existing) {
  if (existing && existing.length >= 16) return existing;
  const token = generateToken();
  // tenant-scan-ignore: contactId comes from the tenant-scoped resolveAudience row (see caller); update keyed by that row's id (authorize-then-act).
  await dbRun(ctx, 'UPDATE marketing_contacts SET unsubscribe_token = ? WHERE id = ?', token, contactId);
  return token;
}

function wrapEmailHtml(body, opts) {
  const isFullDoc = /<\s*html[\s>]/i.test(body);
  const footer = opts.unsubUrl
    ? `<p style="margin-top:32px;color:#94a3b8;font-size:12px;line-height:1.5;">${escapeHtml(opts.copy)}: <a href="${escapeHtml(opts.unsubUrl)}" style="color:#94a3b8;">${escapeHtml(opts.unsubUrl)}</a></p>`
    : '';
  if (isFullDoc) {
    if (/<\/\s*body\s*>/i.test(body)) {
      return body.replace(/<\/\s*body\s*>/i, `${footer}</body>`);
    }
    return body + footer;
  }
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;padding:24px;background:#f8fafc;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;font-size:15px;"><div style="max-width:560px;margin:0 auto;background:#ffffff;padding:32px;border-radius:12px;border:1px solid #e2e8f0;">${body}${footer}</div></body></html>`;
}

export function renderTemplate(tpl, contact, opts = {}) {
  const locale = UNSUB_COPY[opts.locale] ? opts.locale : 'ru';
  const unsubUrl = opts.unsubscribeUrl ?? '';
  const vars = {
    name: contact?.name ?? '',
    first_name: firstName(contact?.name),
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    salon: opts.salonName ?? '',
    unsubscribe_url: unsubUrl,
  };
  const subject = tpl.subject ? substitute(tpl.subject, vars) : '';
  if (tpl.channel === 'email') {
    const bodyRendered = substitute(tpl.body, vars);
    const html = wrapEmailHtml(bodyRendered, { unsubUrl, copy: UNSUB_COPY[locale] });
    const textBody = stripTags(bodyRendered).trim();
    const textFooter = unsubUrl ? `\n\n— ${UNSUB_COPY[locale]}: ${unsubUrl}` : '';
    return { subject, html, text: `${textBody}${textFooter}` };
  }
  return { subject: '', html: '', text: substitute(tpl.body, vars) };
}

/**
 * Send one email via Resend HTTP API. Returns { ok, messageId? } or { ok: false, error }.
 */
async function sendResendEmail(ctx, { to, subject, html, text }) {
  const key = (ctx?.RESEND_API_KEY || '').trim();
  const from = (ctx?.RESEND_FROM || '').trim();
  if (!key || !from) return { ok: false, error: 'resend_not_configured' };
  const body = { from, to: [to], subject, html };
  if (text) body.text = text;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.message || `resend_http_${res.status}`;
      return { ok: false, error: String(msg).slice(0, 200) };
    }
    return { ok: true, messageId: data?.id };
  } catch (e) {
    return { ok: false, error: (e?.message ?? 'fetch_failed').slice(0, 200) };
  }
}

/**
 * Send one SMS via Brevo Transactional SMS API. Returns { ok, messageId? } or { ok: false, error }.
 */
async function sendBrevoSms(ctx, { to, text }) {
  const key = (ctx?.BREVO_API_KEY || '').trim();
  const sender = (ctx?.BREVO_SMS_SENDER || '').trim();
  if (!key || !sender) return { ok: false, error: 'brevo_sms_not_configured' };
  try {
    const res = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender, recipient: to, content: text, type: 'transactional' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.message || `brevo_http_${res.status}`;
      return { ok: false, error: String(msg).slice(0, 200) };
    }
    return { ok: true, messageId: data?.messageId ? String(data.messageId) : undefined };
  } catch (e) {
    return { ok: false, error: (e?.message ?? 'fetch_failed').slice(0, 200) };
  }
}

function parseFilterJson(raw) {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object') return v;
  } catch { /* ignore */ }
  return {};
}

async function resolveAudience(ctx, tenantId, segmentId, channel, limit) {
  let filter = {};
  if (segmentId) {
    const seg = await dbGet(ctx,
      'SELECT filter_json, tenant_id FROM marketing_segments WHERE id = ? LIMIT 1',
      segmentId);
    if (!seg) return { contacts: [], totalCount: 0 };
    if (seg.tenant_id && seg.tenant_id !== tenantId) return { contacts: [], totalCount: 0 };
    filter = parseFilterJson(seg.filter_json);
  }

  const where = ['tenant_id = ?'];
  const params = [tenantId];

  if (filter.excludeUnsubscribed !== false) where.push('unsubscribed = 0');

  const consentCh = filter.consentChannel === 'any' ? null : (filter.consentChannel ?? channel);
  if (consentCh === 'email') {
    where.push('consent_email = 1');
    where.push("coalesce(email, '') <> ''");
  } else if (consentCh === 'sms') {
    where.push('consent_sms = 1');
    where.push("coalesce(phone, '') <> ''");
  }

  if (filter.lifecycleStages && filter.lifecycleStages.length > 0) {
    const placeholders = filter.lifecycleStages.map(() => '?').join(', ');
    where.push(`lifecycle_stage IN (${placeholders})`);
    params.push(...filter.lifecycleStages);
  }

  if (filter.tagsAny && filter.tagsAny.length > 0) {
    const ors = filter.tagsAny.map(() => "(',' || coalesce(tags, '') || ',') LIKE ?");
    where.push(`(${ors.join(' OR ')})`);
    params.push(...filter.tagsAny.map((t) => `%,${String(t).replace(/[^A-Za-z0-9_\-.]/g, '').slice(0, 64)},%`));
  }

  if (filter.tagsAll && filter.tagsAll.length > 0) {
    for (const tag of filter.tagsAll) {
      where.push("(',' || coalesce(tags, '') || ',') LIKE ?");
      params.push(`%,${String(tag).replace(/[^A-Za-z0-9_\-.]/g, '').slice(0, 64)},%`);
    }
  }

  if (filter.lastSeenWithinDays && filter.lastSeenWithinDays > 0) {
    const cutoff = nowSec() - filter.lastSeenWithinDays * 86400;
    where.push('last_seen_at >= ?');
    params.push(cutoff);
  }

  const whereStr = where.join(' AND ');
  const cap = Math.max(1, Math.min(limit ?? INLINE_CAP, INLINE_CAP * 4));
  // tenant-scan-ignore: whereStr always begins with `tenant_id = ?` (resolveAudience, line ~200); scanner can't see tenant_id through the template var.
  const rows = await dbAll(ctx,
    `SELECT id, email, phone, name, unsubscribe_token FROM marketing_contacts WHERE ${whereStr} LIMIT ?`,
    ...params, cap);
  // tenant-scan-ignore: same tenant_id-prefixed whereStr (count query); tenant scoping is inside the template var.
  const totalRow = await dbGet(ctx,
    `SELECT COUNT(*) AS c FROM marketing_contacts WHERE ${whereStr}`,
    ...params);
  return { contacts: rows, totalCount: Number(totalRow?.c ?? rows.length) };
}

/**
 * Run a single campaign end-to-end. Idempotent — a campaign with audience
 * larger than INLINE_CAP stays in status='sending' so the next cron pass
 * processes the remaining queued contacts.
 *
 * `opts.singleContactId` switches to single-recipient mode (used by
 * event-triggered automations like appointment.done): bypasses
 * `resolveAudience` and sends to exactly one marketing_contacts row.
 * The row must exist (no auto-create) and must satisfy the standard
 * consent gates for the campaign's channel — otherwise the send is
 * silently skipped with `total=0, sent=0, failed=0`.
 *
 * Returns { ok, total, sent, failed, deferred, error?, status }.
 */
export async function runCampaignSend(ctx, tenantId, campaignId, opts = {}) {
  const inlineCap = Math.max(1, Math.min(opts.inlineCap ?? INLINE_CAP, INLINE_CAP));
  const singleContactId = opts.singleContactId ?? null;

  const c = await dbGet(ctx,
    'SELECT * FROM marketing_campaigns WHERE id = ? LIMIT 1', campaignId);
  if (!c) return { ok: false, error: 'campaign_not_found', total: 0, sent: 0, failed: 0, deferred: 0, status: 'not_found' };
  if (tenantId && c.tenant_id && c.tenant_id !== tenantId) {
    return { ok: false, error: 'tenant_mismatch', total: 0, sent: 0, failed: 0, deferred: 0, status: c.status };
  }
  if (c.status !== 'draft' && c.status !== 'scheduled' && c.status !== 'sending') {
    return { ok: false, error: `not_eligible_${c.status}`, total: 0, sent: 0, failed: 0, deferred: 0, status: c.status };
  }

  // V-1 (post-fix verification 2026-06-12): universal billing chokepoint.
  // The admin-app gates campaignSendNow/automationRunNow, but a locked tenant
  // could SCHEDULE a campaign (ungated campaignCreate) or trigger an
  // automation event — both reach this sender via the cron dispatcher /
  // fireAutomationForEvent with no billing check, bypassing the marketing-send
  // gate. Read billing_status by the CAMPAIGN's tenant_id (never a maybe-null
  // ctx.tenant → no fail-open) and refuse for an inactive/canceled tenant.
  // Mirrors the Worker `isInactive()` rule; comped grants are 'active' → pass.
  const billing = await dbGet(ctx,
    'SELECT billing_status FROM tenants WHERE id = ? LIMIT 1', c.tenant_id);
  if (billing && (billing.billing_status === 'inactive' || billing.billing_status === 'canceled')) {
    return { ok: false, error: 'billing_locked', total: 0, sent: 0, failed: 0, deferred: 0, status: c.status };
  }

  const now = nowSec();
  if (c.status !== 'sending') {
    // tenant-scan-ignore: campaign c loaded by id + tenant verified above (c.tenant_id !== tenantId guard, line ~271) — authorize-then-act.
    await dbRun(ctx,
      "UPDATE marketing_campaigns SET status = 'sending', started_at = ?, updated_at = ? WHERE id = ?",
      now, now, campaignId);
  }

  if (!c.template_id) {
    // tenant-scan-ignore: same tenant-verified campaign c (authorize-then-act).
    await dbRun(ctx,
      "UPDATE marketing_campaigns SET status = 'failed', error = 'no_template', finished_at = ?, updated_at = ? WHERE id = ?",
      now, now, campaignId);
    return { ok: false, error: 'no_template', total: 0, sent: 0, failed: 0, deferred: 0, status: 'failed' };
  }
  // tenant-scan-ignore: template id taken from the already tenant-verified campaign c (authorize-then-act).
  const tpl = await dbGet(ctx,
    'SELECT * FROM marketing_templates WHERE id = ? LIMIT 1', c.template_id);
  if (!tpl) {
    // tenant-scan-ignore: same tenant-verified campaign c (authorize-then-act).
    await dbRun(ctx,
      "UPDATE marketing_campaigns SET status = 'failed', error = 'template_not_found', finished_at = ?, updated_at = ? WHERE id = ?",
      now, now, campaignId);
    return { ok: false, error: 'template_not_found', total: 0, sent: 0, failed: 0, deferred: 0, status: 'failed' };
  }
  if (tpl.channel !== c.channel) {
    // tenant-scan-ignore: same tenant-verified campaign c (authorize-then-act).
    await dbRun(ctx,
      "UPDATE marketing_campaigns SET status = 'failed', error = 'channel_mismatch', finished_at = ?, updated_at = ? WHERE id = ?",
      now, now, campaignId);
    return { ok: false, error: 'channel_mismatch', total: 0, sent: 0, failed: 0, deferred: 0, status: 'failed' };
  }

  const channel = c.channel;
  const tenant = await dbGet(ctx, 'SELECT name FROM tenants WHERE id = ? LIMIT 1', tenantId);
  const salonName = tenant?.name ?? null;

  let contacts;
  let totalCount;
  if (singleContactId != null) {
    // Single-recipient mode (event-triggered automations).
    // Apply the same consent + tenant scoping the segment-based path
    // applies so an unsubscribed user or a wrong-tenant id is a no-op.
    const consentCol = channel === 'email' ? 'consent_email = 1' : 'consent_sms = 1';
    const valueCol = channel === 'email' ? "coalesce(email, '') <> ''" : "coalesce(phone, '') <> ''";
    const row = await dbGet(ctx,
      `SELECT id, email, phone, name, unsubscribe_token FROM marketing_contacts
       WHERE id = ? AND tenant_id = ? AND unsubscribed = 0
         AND ${consentCol} AND ${valueCol} LIMIT 1`,
      singleContactId, tenantId);
    contacts = row ? [row] : [];
    totalCount = contacts.length;
  } else {
    const a = await resolveAudience(ctx, tenantId, c.segment_id, channel, inlineCap);
    contacts = a.contacts;
    totalCount = a.totalCount;
  }

  let sent = 0;
  let failed = 0;
  for (const row of contacts) {
    const recipient = channel === 'email' ? (row.email || '') : (row.phone || '');
    if (!recipient) { failed += 1; continue; }
    const sendId = rid('snd');
    const queuedAt = nowSec();
    try {
      await dbRun(ctx,
        `INSERT INTO marketing_sends (id, campaign_id, contact_id, recipient, provider, status, queued_at)
         VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
        sendId, campaignId, row.id, recipient,
        channel === 'email' ? 'resend' : 'brevo',
        queuedAt);
    } catch (e) {
      // Likely a duplicate PK (cron retry) — skip.
      log.warn('services.marketing.sender', { action: 'insert_send_failed', error: e?.message, campaignId });
      continue;
    }

    let unsubUrl = '';
    if (channel === 'email') {
      const token = await ensureUnsubscribeToken(ctx, row.id, row.unsubscribe_token);
      unsubUrl = `${publicOrigin(ctx)}/u/${token}`;
    }

    const rendered = renderTemplate(
      { channel, subject: tpl.subject, body: tpl.body },
      { name: row.name, email: row.email, phone: row.phone },
      { salonName, unsubscribeUrl: unsubUrl, locale: tpl.locale || 'ru' },
    );

    const result = channel === 'email'
      ? await sendResendEmail(ctx, {
          to: recipient,
          subject: rendered.subject || tpl.name,
          html: rendered.html,
          text: rendered.text,
        })
      : await sendBrevoSms(ctx, { to: recipient, text: rendered.text });

    const completedAt = nowSec();
    if (result.ok) {
      sent += 1;
      await dbRun(ctx,
        "UPDATE marketing_sends SET status = 'sent', provider_message_id = ?, sent_at = ? WHERE id = ?",
        result.messageId ?? null, completedAt, sendId);
    } else {
      failed += 1;
      await dbRun(ctx,
        "UPDATE marketing_sends SET status = 'failed', error = ?, sent_at = ? WHERE id = ?",
        (result.error ?? 'send_failed').slice(0, 500), completedAt, sendId);
    }
  }

  const deferred = Math.max(0, totalCount - contacts.length);
  const finishedAt = nowSec();
  const stats = { total: totalCount, sent, failed, deferred };
  const terminalStatus = deferred > 0
    ? 'sending'
    : (failed === contacts.length && contacts.length > 0 ? 'failed' : 'sent');

  // tenant-scan-ignore: same tenant-verified campaign c, terminal status write (authorize-then-act).
  await dbRun(ctx,
    `UPDATE marketing_campaigns
       SET status = ?, finished_at = ?, stats_json = ?, error = ?, updated_at = ?
     WHERE id = ?`,
    terminalStatus,
    terminalStatus === 'sending' ? null : finishedAt,
    JSON.stringify(stats),
    terminalStatus === 'failed' ? 'all_sends_failed' : null,
    finishedAt,
    campaignId);

  return { ok: terminalStatus !== 'failed', total: totalCount, sent, failed, deferred, status: terminalStatus };
}
