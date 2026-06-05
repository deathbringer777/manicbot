/**
 * Worker-side capture of a client's email from chat into the tenant-scoped
 * marketing_contacts directory, with consent logging.
 *
 * The admin-app has `syncMarketingContact` (Drizzle, directory-only, inserts
 * with consent_email=0). The Worker can't import that, and chat capture
 * additionally GRANTS consent (the client volunteered/confirmed their email at
 * us). This module mirrors the dedup/merge semantics (lookup email > phone >
 * tg > ig, additive merge, never overwrite a curated marketing value) using the
 * raw dbGet/dbRun helpers, and writes a `marketing_consent_log` opt-in row when
 * grantConsent is set.
 *
 * Consent model (owner decision): any email a client leaves — prompted or
 * spontaneous — is a soft opt-in (consent_email=1), valid because every send
 * carries an unsubscribe link (the sender enforces it) AND there is an in-chat
 * opt-out (`setChatEmailOptOut`). The consent-log `source` records the funnel
 * point so provenance is auditable. Vocabulary matches the rest of the codebase:
 * event='subscribed' on opt-in, 'unsubscribed' on opt-out, note='email'. MKT-01.
 *
 * Tenant isolation: every marketing_contacts / users statement carries
 * `tenant_id` (INSERT in the column list, SELECT/UPDATE in the WHERE).
 * marketing_consent_log has no tenant_id column (keyed by contact_id).
 */

import { dbGet, dbRun } from '../../utils/db.js';
import { log } from '../../utils/logger.js';
import { EMAIL_REGEX, generateUnsubscribeToken } from '../../http/subscribeHttpLogic.js';
import { nowSec } from '../../utils/time.js';

/** Re-ask cadence (durable anti-nag; see migration 0109 + shouldAskEmail). */
export const EMAIL_REASK_COOLDOWN_SEC = 14 * 24 * 3600; // 14 days
export const EMAIL_MAX_PROMPTS = 3;
/** Proactive re-ask cron (Scenario C) tuning. */
export const EMAIL_REENGAGE_DELAY_SEC = 14 * 24 * 3600; // first contact must be ≥14d ago
export const EMAIL_REASK_BATCH = 50;        // max prompts per tenant per cron tick
export const EMAIL_REASK_SCAN_LIMIT = 500;  // max candidate rows scanned per tick

const MAX_EMAIL_LEN = 254;

/** Channel → consent-log source for prompted opt-ins. */
const CHANNEL_SOURCE = {
  telegram: 'chat_optin_telegram',
  web: 'chat_optin_web',
  instagram: 'chat_optin_instagram',
  whatsapp: 'chat_optin_whatsapp',
};

/** Resolve the consent-log `source` for a prompted capture from the channel. */
export function channelOptinSource(channelType) {
  return CHANNEL_SOURCE[channelType] || 'chat_optin_telegram';
}

/** Normalize + validate an email. Returns the lowercased address or null. */
export function normalizeEmail(raw) {
  const e = String(raw ?? '').trim().toLowerCase();
  if (!e || e.length > MAX_EMAIL_LEN || !EMAIL_REGEX.test(e)) return null;
  return e;
}

function normPhone(raw) {
  if (!raw) return null;
  const stripped = String(raw).trim().replace(/[^\d+]/g, '');
  return stripped.length >= 4 ? stripped : null;
}

function normHandle(raw) {
  if (!raw) return null;
  const h = String(raw).trim().toLowerCase().replace(/^@+/, '');
  return h.length > 0 ? h : null;
}

function parseCustomFields(raw) {
  if (!raw) return {};
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

function buildCustomFields(existing, tg, ig) {
  const next = { ...existing };
  if (tg) next.tg_username = tg;
  if (ig) next.ig_username = ig;
  return Object.keys(next).length ? JSON.stringify(next) : null;
}

const CONTACT_COLS =
  'id, email, phone, name, custom_fields, linked_user_chat_id, lead_count, unsubscribe_token, consent_email, unsubscribed';

/**
 * Resolve an existing tenant contact for this person. Priority email > phone,
 * falling back to tg/ig handle ONLY when neither email nor phone is known
 * (the handle lookup needs a LIKE on custom_fields; chat capture always carries
 * an email, so the fallback is real-D1 only and never hit in the common path).
 */
async function lookupContact(ctx, tenantId, email, phone, tg, ig) {
  if (email) {
    const r = await dbGet(ctx, `SELECT ${CONTACT_COLS} FROM marketing_contacts WHERE tenant_id = ? AND email = ? LIMIT 1`, tenantId, email);
    if (r) return r;
  }
  if (phone) {
    const r = await dbGet(ctx, `SELECT ${CONTACT_COLS} FROM marketing_contacts WHERE tenant_id = ? AND phone = ? LIMIT 1`, tenantId, phone);
    if (r) return r;
  }
  if (!email && !phone && tg) {
    const r = await dbGet(ctx, `SELECT ${CONTACT_COLS} FROM marketing_contacts WHERE tenant_id = ? AND custom_fields LIKE ? LIMIT 1`, tenantId, `%"tg_username":"${tg}"%`);
    if (r) return r;
  }
  if (!email && !phone && !tg && ig) {
    const r = await dbGet(ctx, `SELECT ${CONTACT_COLS} FROM marketing_contacts WHERE tenant_id = ? AND custom_fields LIKE ? LIMIT 1`, tenantId, `%"ig_username":"${ig}"%`);
    if (r) return r;
  }
  return null;
}

/**
 * Capture a client's email from chat: store on users, dedup/merge into the
 * tenant marketing_contacts directory, grant + log consent, and link the rows.
 *
 * @param {object} ctx Worker context (ctx.db, ctx.tenantId).
 * @param {{chatId:number, email:string, name?:string|null, phone?:string|null,
 *   tgUsername?:string|null, igUsername?:string|null, locale?:string|null,
 *   source?:string, ip?:string|null, userAgent?:string|null, grantConsent?:boolean}} input
 * @returns {Promise<{ok:boolean, reason?:string, contactId?:number|null, consentGranted?:boolean}>}
 */
export async function captureChatEmail(ctx, input = {}) {
  const {
    chatId, name = null, phone = null, tgUsername = null, igUsername = null,
    locale = null, source = 'chat_volunteered', ip = null, userAgent = null,
    grantConsent = true,
  } = input;
  if (!ctx?.db?.prepare || !ctx?.tenantId || chatId == null) return { ok: false, reason: 'no_ctx' };

  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, reason: 'invalid_email' };

  const tenantId = ctx.tenantId;
  const now = nowSec();
  const ph = normPhone(phone);
  const tg = normHandle(tgUsername);
  const ig = normHandle(igUsername);

  try {
    // 1) Persist on the client row WITHOUT routing through saveUser (which only
    //    touches registration fields). A grant flips opt-in + stamps the prompt.
    if (grantConsent) {
      await dbRun(ctx, 'UPDATE users SET email = ?, email_opt_in = ?, email_prompt_last_at = ? WHERE tenant_id = ? AND chat_id = ?', email, 1, now, tenantId, chatId);
    } else {
      await dbRun(ctx, 'UPDATE users SET email = ? WHERE tenant_id = ? AND chat_id = ?', email, tenantId, chatId);
    }

    // 2) Resolve or create the tenant marketing contact (additive merge).
    const existing = await lookupContact(ctx, tenantId, email, ph, tg, ig);
    let contactId;
    if (existing) {
      const sets = ['last_seen_at = ?', 'lead_count = ?'];
      const params = [now, (existing.lead_count || 0) + 1];
      if (existing.linked_user_chat_id == null) { sets.push('linked_user_chat_id = ?'); params.push(chatId); }
      if (!existing.email) { sets.push('email = ?'); params.push(email); }
      if (!existing.phone && ph) { sets.push('phone = ?'); params.push(ph); }
      if (!existing.name && name) { sets.push('name = ?'); params.push(name); }
      const newCustom = buildCustomFields(parseCustomFields(existing.custom_fields), tg, ig);
      if (newCustom !== existing.custom_fields) { sets.push('custom_fields = ?'); params.push(newCustom); }
      let token = existing.unsubscribe_token;
      if (!token || String(token).length < 16) { token = generateUnsubscribeToken(); sets.push('unsubscribe_token = ?'); params.push(token); }
      if (grantConsent) { sets.push('consent_email = ?', 'unsubscribed = ?'); params.push(1, 0); }
      params.push(tenantId, existing.id);
      await dbRun(ctx, `UPDATE marketing_contacts SET ${sets.join(', ')} WHERE tenant_id = ? AND id = ?`, ...params);
      contactId = existing.id;
    } else {
      const token = generateUnsubscribeToken();
      const customFields = buildCustomFields({}, tg, ig);
      const res = await dbRun(ctx,
        `INSERT INTO marketing_contacts (tenant_id, email, name, phone, source, first_seen_at, last_seen_at, lead_count, unsubscribed, consent_email, consent_sms, custom_fields, locale, linked_user_chat_id, unsubscribe_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        tenantId, email, name, ph, source, now, now, 1, 0, grantConsent ? 1 : 0, 0, customFields, locale, chatId, token);
      contactId = res?.meta?.last_row_id ?? null;
      if (contactId == null) {
        const r = await dbGet(ctx, 'SELECT id FROM marketing_contacts WHERE tenant_id = ? AND email = ? LIMIT 1', tenantId, email);
        contactId = r?.id ?? null;
      }
    }

    // 3) Log the opt-in (authoritative consent record). marketing_consent_log
    //    has no tenant_id (keyed by contact_id).
    if (grantConsent && contactId != null) {
      await dbRun(ctx, "INSERT INTO marketing_consent_log (contact_id, event, source, ip, user_agent, note, created_at) VALUES (?, 'subscribed', ?, ?, ?, 'email', ?)", contactId, source, ip, userAgent, now);
    }

    // 4) Link the client row to the resolved contact.
    if (contactId != null) {
      await dbRun(ctx, 'UPDATE users SET marketing_contact_id = ? WHERE tenant_id = ? AND chat_id = ?', contactId, tenantId, chatId);
    }

    // 5) Killer-feature seam: a freshly consented contact is now reachable by
    //    the marketing automation engine. Fire a dedicated event so a (disabled-
    //    by-default) welcome automation can greet them. Wrapped — a failure here
    //    must never fail the capture itself.
    if (grantConsent && contactId != null) {
      try {
        const { fireAutomationForEvent } = await import('./automations.js');
        await fireAutomationForEvent(ctx, 'contact.email_captured', { chatId });
      } catch (e) {
        log.warn('marketing.contacts', { action: 'fire_capture_event_failed', error: e?.message?.slice(0, 120) });
      }
    }

    return { ok: true, contactId, consentGranted: !!grantConsent };
  } catch (e) {
    log.error('marketing.contacts', e instanceof Error ? e : new Error(String(e?.message)), { phase: 'capture', tenantId, source });
    return { ok: false, reason: 'db_error' };
  }
}

/**
 * In-chat opt-out (the "управление рассылкой / отписаться" button, keyed by
 * chat_id). Flips the client + their marketing contact to unsubscribed and logs
 * it, mirroring the /u/<token> unsubscribe path's vocabulary.
 */
export async function setChatEmailOptOut(ctx, chatId, { source = 'chat_settings' } = {}) {
  if (!ctx?.db?.prepare || !ctx?.tenantId || chatId == null) return { ok: false, reason: 'no_ctx' };
  const tenantId = ctx.tenantId;
  const now = nowSec();
  try {
    await dbRun(ctx, 'UPDATE users SET email_opt_in = ? WHERE tenant_id = ? AND chat_id = ?', 0, tenantId, chatId);
    const contact = await dbGet(ctx, 'SELECT id FROM marketing_contacts WHERE tenant_id = ? AND linked_user_chat_id = ? LIMIT 1', tenantId, chatId);
    if (contact?.id != null) {
      await dbRun(ctx, 'UPDATE marketing_contacts SET consent_email = ?, unsubscribed = ? WHERE tenant_id = ? AND id = ?', 0, 1, tenantId, contact.id);
      await dbRun(ctx, "INSERT INTO marketing_consent_log (contact_id, event, source, note, created_at) VALUES (?, 'unsubscribed', ?, 'email', ?)", contact.id, source, now);
    }
    return { ok: true, contactId: contact?.id ?? null };
  } catch (e) {
    log.error('marketing.contacts', e instanceof Error ? e : new Error(String(e?.message)), { phase: 'optout', tenantId });
    return { ok: false, reason: 'db_error' };
  }
}

/**
 * Should we show the email-ask prompt to this user now? Pure gating predicate;
 * the caller is additionally wrapped by the EMAIL_CAPTURE feature flag.
 */
export function shouldAskEmail(user, now = nowSec(), opts = {}) {
  const cooldownSec = opts.cooldownSec ?? EMAIL_REASK_COOLDOWN_SEC;
  const maxPrompts = opts.maxPrompts ?? EMAIL_MAX_PROMPTS;
  if (!user) return true;                       // no record yet → ok (caller gates)
  if (user.email) return false;                 // already captured
  if (user.emailOptIn === 0) return false;      // declined / unsubscribed
  if ((user.emailPromptCount ?? 0) >= maxPrompts) return false;
  const last = user.emailPromptLastAt;
  if (last && now - last < cooldownSec) return false;
  return true;
}

/**
 * Eligible for the PROACTIVE re-ask (Scenario C cron): all of shouldAskEmail
 * PLUS first contact (first_touch_at, falling back to registered_at) is at least
 * REENGAGE_DELAY ago. Covers people who only used the bot and never booked.
 * A user with no known first-contact anchor is skipped (can't age-gate them).
 */
export function isReaskEligible(user, now = nowSec(), opts = {}) {
  if (!shouldAskEmail(user, now, opts)) return false;
  const reengageSec = opts.reengageSec ?? EMAIL_REENGAGE_DELAY_SEC;
  const firstContact = user?.firstTouchAt ?? user?.registeredAt ?? null;
  if (firstContact == null) return false;
  return now - firstContact >= reengageSec;
}

/** Stamp that we showed the prompt (anti-nag cooldown + count). */
export async function stampEmailPrompt(ctx, chatId, now = nowSec()) {
  if (!ctx?.db?.prepare || !ctx?.tenantId || chatId == null) return;
  const tenantId = ctx.tenantId;
  const u = await dbGet(ctx, 'SELECT email_prompt_count FROM users WHERE tenant_id = ? AND chat_id = ?', tenantId, chatId);
  const count = (u?.email_prompt_count ?? 0) + 1;
  await dbRun(ctx, 'UPDATE users SET email_prompt_last_at = ?, email_prompt_count = ? WHERE tenant_id = ? AND chat_id = ?', now, count, tenantId, chatId);
}
