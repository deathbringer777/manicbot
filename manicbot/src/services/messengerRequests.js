/**
 * @fileoverview Booking-request cards in the staff "Заявки" inbox thread.
 *
 * Every new appointment — from ANY channel (Telegram/WhatsApp/Instagram/Web),
 * auto-confirmed or pending — posts one actionable card into a per-tenant
 * `requests` thread so masters can claim/confirm it from the web dashboard.
 * This is the dashboard mirror of the Telegram fan-out in notifications.js:
 *   - assigned + pending   → card "→ {master}", master also pinged personally
 *   - unassigned + pending → card anyone can claim (first claim wins)
 *   - auto-confirmed        → card shown as confirmed (FYI), no action
 *
 * The thread id is deterministic (`rq_<tenantId>`) so find-or-create is
 * race-safe on the primary key; a partial UNIQUE index
 * `(tenant_id) WHERE kind='requests'` (migration 0094) is the backstop.
 *
 * Failure posture (mirrors messengerThreads.js): every export logs and
 * swallows so a messenger hiccup never blocks booking creation or the
 * Telegram notification.
 */

import { dbAll, dbGet, dbRunSafe } from '../utils/db.js';
import { ulid } from '../utils/ulid.js';
import { log } from '../utils/logger.js';

const REQUESTS_TITLE = 'Заявки';
const REF_KIND = 'booking_request';

/** Localized card headers (PL/RU/UA/EN) — the body is a plain-text fallback;
 *  the web messenger renders the rich card from meta_json. */
const HEADER = {
  pending: {
    ru: '🆕 Новая заявка на запись',
    ua: '🆕 Нова заявка на запис',
    en: '🆕 New booking request',
    pl: '🆕 Nowa prośba o rezerwację',
  },
  confirmed: {
    ru: '✅ Новая запись (подтверждена)',
    ua: '✅ Новий запис (підтверджено)',
    en: '✅ New booking (confirmed)',
    pl: '✅ Nowa rezerwacja (potwierdzona)',
  },
};

function pick(map, lang) {
  return map[lang] || map.ru;
}

/** Deterministic per-tenant requests thread id. */
export function requestsThreadId(tenantId) {
  return `rq_${tenantId}`;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function previewBody(s) {
  if (!s) return '';
  const oneLine = String(s).replace(/\s+/g, ' ').trim();
  return oneLine.length > 200 ? oneLine.slice(0, 200) : oneLine;
}

/**
 * Seed the requests thread with the owner + every active master, mirroring
 * the membership model of the default "Команда" group (migration 0093):
 *   - tenant_owner            → member_kind='web_user'
 *   - master with web account → member_kind='web_user'
 *   - Telegram-only master    → member_kind='master', ref=String(chat_id)
 * Idempotent via the composite PK on thread_members.
 */
async function seedRequestsMembers(ctx, tenantId, threadId, now) {
  const addMember = (kind, ref, role) =>
    dbRunSafe(
      ctx,
      `INSERT INTO thread_members
         (thread_id, member_kind, member_ref, role, joined_at, muted_until,
          last_read_message_id, last_read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(thread_id, member_kind, member_ref) DO NOTHING`,
      threadId, kind, String(ref), role, now, null, null, null,
    ).catch((e) =>
      log.warn('messengerRequests.seed', { action: 'member_insert', error: e?.message }),
    );

  const owners = await dbAll(
    ctx,
    "SELECT id FROM web_users WHERE tenant_id = ? AND role = 'tenant_owner' LIMIT 1",
    tenantId,
  ).catch(() => []);
  if (owners[0]?.id) await addMember('web_user', owners[0].id, 'owner');

  const masters = await dbAll(
    ctx,
    'SELECT chat_id, web_user_id FROM masters WHERE tenant_id = ? AND active = 1 AND archived_at IS NULL',
    tenantId,
  ).catch(() => []);
  for (const m of masters) {
    if (m.web_user_id) await addMember('web_user', m.web_user_id, 'member');
    else if (m.chat_id != null) await addMember('master', m.chat_id, 'member');
  }
}

/**
 * Find-or-create the per-tenant "Заявки" requests thread and ensure its
 * membership. Returns the thread id, or null on hard failure.
 */
export async function ensureRequestsThread(ctx, tenantId) {
  if (!ctx?.db || !tenantId) return null;
  const threadId = requestsThreadId(tenantId);
  const now = nowSec();
  try {
    const existing = await dbGet(
      ctx,
      'SELECT id FROM threads WHERE id = ? AND tenant_id = ? LIMIT 1',
      threadId, tenantId,
    ).catch(() => null);

    if (!existing) {
      const owners = await dbAll(
        ctx,
        "SELECT id FROM web_users WHERE tenant_id = ? AND role = 'tenant_owner' LIMIT 1",
        tenantId,
      ).catch(() => []);
      const ownerWebUserId = owners[0]?.id ?? null;
      try {
        await dbRunSafe(
          ctx,
          `INSERT INTO threads
             (id, tenant_id, kind, title, client_conversation_id, dm_key,
              created_by_web_user_id, created_at, last_message_at,
              last_message_preview, archived, is_default_group)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          threadId, tenantId, 'requests', REQUESTS_TITLE, null, null,
          ownerWebUserId, now, now, null, 0, 0,
        );
      } catch (e) {
        // Race on the deterministic PK / partial unique index — recover.
        const raced = await dbGet(
          ctx,
          'SELECT id FROM threads WHERE id = ? AND tenant_id = ? LIMIT 1',
          threadId, tenantId,
        ).catch(() => null);
        if (!raced) {
          log.error('messengerRequests.ensure',
            e instanceof Error ? e : new Error(String(e?.message)),
            { action: 'thread_insert', tenantId });
          return null;
        }
      }
    }

    await seedRequestsMembers(ctx, tenantId, threadId, now);
    return threadId;
  } catch (e) {
    log.error('messengerRequests.ensure',
      e instanceof Error ? e : new Error(String(e?.message)),
      { action: 'ensureRequestsThread', tenantId });
    return null;
  }
}

function buildRequestBody(meta, lang) {
  const headerMap = meta.status === 'confirmed' ? HEADER.confirmed : HEADER.pending;
  const lines = [pick(headerMap, lang)];
  if (meta.clientName) lines.push(`👤 ${meta.clientName}`);
  if (meta.clientPhone) lines.push(`📱 ${meta.clientPhone}`);
  if (meta.svcName) lines.push(`💅 ${meta.svcName}`);
  if (meta.when) lines.push(`📅 ${meta.when}`);
  if (meta.masterName) lines.push(`💇 ${meta.masterName}`);
  return lines.join('\n');
}

/**
 * Post (or refresh) the booking-request card for an appointment into the
 * tenant's requests thread. Idempotent per appointment: a re-post (e.g. an
 * auto-confirmed booking, or a later status change) updates the existing card
 * instead of duplicating it.
 *
 * @param {object} ctx - tenant context (ctx.db, ctx.tenantId)
 * @param {object} apt - appointment row ({ id, masterId, ... })
 * @param {object} opts
 * @param {boolean} opts.autoConfirmed - true → card shown as confirmed FYI
 * @param {string=} opts.lang - card language (PL/RU/UA/EN)
 * @param {string=} opts.svcName - localized service name
 * @param {string=} opts.when - formatted date/time
 * @param {string=} opts.clientName
 * @param {string=} opts.clientPhone
 * @param {string=} opts.channel - origin channel ('web'|'telegram'|...)
 * @param {number|string|null=} opts.masterId - assigned master (null = unassigned)
 * @param {string|null=} opts.masterName - assigned master display name
 * @returns {Promise<{threadId: string, messageId: string}|null>}
 */
export async function postBookingRequest(ctx, apt, opts = {}) {
  if (!ctx?.db || !ctx?.tenantId || !apt?.id) return null;
  const tenantId = ctx.tenantId;
  try {
    const threadId = await ensureRequestsThread(ctx, tenantId);
    if (!threadId) return null;
    const now = nowSec();
    const status = opts.autoConfirmed ? 'confirmed' : 'pending';
    const meta = {
      appointmentId: apt.id,
      status,
      autoConfirmed: !!opts.autoConfirmed,
      channel: opts.channel ?? null,
      svcName: opts.svcName ?? null,
      when: opts.when ?? null,
      clientName: opts.clientName ?? null,
      clientPhone: opts.clientPhone ?? null,
      masterId: opts.masterId ?? apt.masterId ?? null,
      masterName: opts.masterName ?? null,
      lang: opts.lang ?? 'ru',
    };
    const body = buildRequestBody(meta, meta.lang);
    const metaJson = JSON.stringify(meta);

    // Idempotent: one card per appointment. Update on re-post.
    const existing = await dbGet(
      ctx,
      `SELECT id FROM thread_messages
         WHERE tenant_id = ? AND ref_kind = 'booking_request' AND ref_id = ?
         LIMIT 1`,
      tenantId, apt.id,
    ).catch(() => null);

    let messageId;
    if (existing?.id) {
      messageId = existing.id;
      await dbRunSafe(
        ctx,
        `UPDATE thread_messages
            SET body = ?, meta_json = ?, edited_at = ?
          WHERE id = ? AND tenant_id = ?`,
        body, metaJson, now, messageId, tenantId,
      );
    } else {
      messageId = ulid();
      await dbRunSafe(
        ctx,
        `INSERT INTO thread_messages
           (id, thread_id, tenant_id, sender_kind, sender_ref, body,
            attachments_json, is_internal_note, external_msg_id,
            reply_to_message_id, created_at, edited_at, deleted_at,
            ref_kind, ref_id, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        messageId, threadId, tenantId, 'system', 'booking', body,
        null, 0, null, null, now, null, null,
        REF_KIND, String(apt.id), metaJson,
      );
    }

    await dbRunSafe(
      ctx,
      `UPDATE threads
          SET last_message_at = ?, last_message_preview = ?, archived = 0
        WHERE id = ? AND tenant_id = ?`,
      now, previewBody(body), threadId, tenantId,
    );

    return { threadId, messageId };
  } catch (e) {
    log.error('messengerRequests.post',
      e instanceof Error ? e : new Error(String(e?.message)),
      { action: 'postBookingRequest', tenantId, aptId: apt?.id });
    return null;
  }
}
