import { WORK, MAX_APTS, CLEANUP_AFTER_MS, TIMEZONE } from '../config.js';
import { kvGet, kvPut, kvDel } from '../utils/kv.js';
import { dbGet, dbAll, dbRun } from '../utils/db.js';
import { nowSec } from '../utils/time.js';
import { p2 } from '../utils/helpers.js';
import { warsawNow, warsawToUTC, todayStr } from '../utils/date.js';
import { getMaster } from './users.js';
import { deleteAppointmentCalendar, loadExternalBusyBlocks } from './google-calendar-oauth.js';

function allKey(dateStr) {
  return `all:${dateStr.slice(0, 7)}`;
}

function dayIndexKey(date, masterId = null) {
  return `d:${date}`;
}

function getAptMasterId(apt) { return apt?.masterId || apt?.master_id || null; }
function isSharedApt(apt) { return !getAptMasterId(apt); }

function aptRowToDoc(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    chatId: row.chat_id,
    svcId: row.svc_id,
    date: row.date,
    time: row.time,
    ts: row.ts,
    status: row.status,
    masterId: row.master_id,
    userName: row.user_name,
    userPhone: row.user_phone,
    userTg: row.user_tg,
    confirmedBy: row.confirmed_by,
    counterTime: row.counter_time,
    counterComment: row.counter_comment,
    rejectComment: row.reject_comment,
    cancelReason: row.cancel_reason,
    cx: row.cancelled === 1,
    cancelled: row.cancelled === 1,
    rem: { h24: row.rem_h24 === 1, h2: row.rem_h2 === 1 },
    googleEventId: row.google_event_id,
    googleCalendarId: row.google_calendar_id,
    googleIntegrationId: row.google_integration_id,
    createdAt: row.created_at,
  };
}

function normalizeAptDoc(apt) {
  if (!apt) return null;
  if ('tenant_id' in apt || 'master_id' in apt || 'chat_id' in apt) return aptRowToDoc(apt);
  return {
    ...apt,
    masterId: getAptMasterId(apt),
    confirmedBy: apt.confirmedBy || apt.confirmed_by || null,
    counterTime: apt.counterTime || apt.counter_time || null,
    counterComment: apt.counterComment || apt.counter_comment || null,
    rejectComment: apt.rejectComment || apt.reject_comment || null,
    cancelReason: apt.cancelReason || apt.cancel_reason || null,
    googleEventId: apt.googleEventId || apt.google_event_id || null,
    googleCalendarId: apt.googleCalendarId || apt.google_calendar_id || null,
    googleIntegrationId: apt.googleIntegrationId || apt.google_integration_id || null,
    cancelled: apt.cancelled === true || apt.cancelled === 1 || apt.cx === true || apt.cx === 1,
    cx: apt.cancelled === true || apt.cancelled === 1 || apt.cx === true || apt.cx === 1,
    rem: apt.rem || { h24: false, h2: false },
  };
}

function localDateTimeParts(ts) {
  const parts = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ts))) parts[type] = value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: (parseInt(parts.hour, 10) % 24) * 60 + parseInt(parts.minute, 10),
  };
}

function externalBlockOverlapsSlot(date, startMin, endMin, block) {
  const blockStart = localDateTimeParts(block.startTs);
  const blockEnd = localDateTimeParts(block.endTs);
  const blockStartMin = blockStart.date < date ? 0 : blockStart.minutes;
  const blockEndMin = blockEnd.date > date ? 24 * 60 : blockEnd.minutes;
  return startMin < blockEndMin && endMin > blockStartMin;
}

async function addToIndexes(ctx, apt) {
  const monthKey = allKey(apt.date);
  const dKey = dayIndexKey(apt.date, getAptMasterId(apt));
  const [dl, al] = await Promise.all([kvGet(ctx, dKey), kvGet(ctx, monthKey)]);
  const newDl = dl || [];
  const newAl = al || [];
  newDl.push(apt.id);
  newAl.push(apt.id);
  await Promise.all([
    kvPut(ctx, dKey, newDl),
    kvPut(ctx, monthKey, newAl),
  ]);
}

async function removeFromIndexes(ctx, apt) {
  const monthKey = allKey(apt.date);
  const dKey = dayIndexKey(apt.date, getAptMasterId(apt));
  const [dl, al] = await Promise.all([kvGet(ctx, dKey), kvGet(ctx, monthKey)]);
  const newDl = (dl || []).filter(x => x !== apt.id);
  const newAl = (al || []).filter(x => x !== apt.id);
  await Promise.all([
    newDl.length === 0 ? kvDel(ctx, dKey) : kvPut(ctx, dKey, newDl),
    newAl.length === 0 ? kvDel(ctx, monthKey) : kvPut(ctx, monthKey, newAl),
  ]);
}

export async function loadDayAppointments(ctx, date, masterId = null) {
  if (!ctx?.db || !ctx?.tenantId) {
    const ids = (await kvGet(ctx, dayIndexKey(date, masterId))) || [];
    const fetched = await Promise.all(ids.map(id => kvGet(ctx, `ap:${id}`)));
    const active = fetched
      .map(normalizeAptDoc)
      .filter(a => a && !a.cx);
    if (masterId != null) {
      return active.filter(a => getAptMasterId(a) === masterId || a.confirmedBy === masterId);
    }
    return active;
  }
  let rows;
  if (masterId != null) {
    rows = await dbAll(ctx,
      'SELECT * FROM appointments WHERE tenant_id = ? AND date = ? AND cancelled = 0 AND (master_id = ? OR confirmed_by = ?)',
      ctx.tenantId, date, masterId, masterId,
    );
  } else {
    rows = await dbAll(ctx,
      'SELECT * FROM appointments WHERE tenant_id = ? AND date = ? AND cancelled = 0',
      ctx.tenantId, date,
    );
  }
  return rows.map(aptRowToDoc);
}

export async function saveApt(ctx, apt) {
  // Preview-mode short-circuit: landing demo tenant must not write real
  // appointments. Return a synthetic doc so the confirmation UI still renders
  // "✅ Запись оформлена". Flag is set by channels/resolver.js from
  // tenant_config.preview_mode and by src/tenant/previewTenant.js.
  if (ctx?.previewMode) {
    const rnd = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(36)).join('').slice(0, 8);
    return {
      ...apt,
      id: `demo_${rnd}`,
      masterId: apt.masterId || null,
      status: 'pending',
      createdAt: nowSec(),
      rem: { h24: false, h2: false },
      confirmedBy: null,
      counterTime: null,
      counterComment: null,
      rejectComment: null,
      cancelReason: null,
      previewOnly: true,
    };
  }

  if (!ctx?.db || !ctx?.tenantId) {
    const ul = (await kvGet(ctx, `ua:${apt.chatId}`)) || [];
    const existing = await Promise.all(ul.map(id => kvGet(ctx, `ap:${id}`)));
    const active = existing
      .map(normalizeAptDoc)
      .filter(a => a && !a.cx && a.ts > Date.now()).length;
    if (active >= MAX_APTS) return null;

    const rnd = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(36)).join('').slice(0, 8);
    const id = `a${Date.now()}_${rnd}`;
    apt.id = id;
    apt.masterId = apt.masterId || null;
    apt.status = 'pending';
    apt.createdAt = nowSec();
    apt.rem = { h24: false, h2: false };
    apt.confirmedBy = null;
    apt.counterTime = null;
    apt.counterComment = null;
    apt.rejectComment = null;
    apt.cancelReason = null;

    ul.push(id);
    await Promise.all([
      kvPut(ctx, `ap:${id}`, apt),
      kvPut(ctx, `ua:${apt.chatId}`, ul),
      addToIndexes(ctx, apt),
    ]);
    return apt;
  }

  const countRow = await dbGet(ctx,
    'SELECT COUNT(*) as cnt FROM appointments WHERE tenant_id = ? AND chat_id = ? AND cancelled = 0 AND ts > ?',
    ctx.tenantId, apt.chatId, Date.now(),
  );
  if ((countRow?.cnt || 0) >= MAX_APTS) return null;

  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(36)).join('').slice(0, 8);
  const id = `a${Date.now()}_${rnd}`;
  apt.id = id;
  apt.masterId = apt.masterId || null;
  apt.status = 'pending';
  apt.createdAt = nowSec();
  apt.rem = { h24: false, h2: false };
  apt.confirmedBy = null;
  apt.counterTime = null;
  apt.counterComment = null;
  apt.rejectComment = null;
  apt.cancelReason = null;

  await dbRun(ctx,
    `INSERT INTO appointments (id, tenant_id, chat_id, svc_id, date, time, ts, status, master_id, user_name, user_phone, user_tg, confirmed_by, counter_time, counter_comment, reject_comment, cancel_reason, cancelled, rem_h24, rem_h2, google_event_id, google_calendar_id, google_integration_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?)`,
    id, ctx.tenantId, apt.chatId, apt.svcId, apt.date, apt.time, apt.ts,
    'pending', apt.masterId, apt.userName || null, apt.userPhone || null, apt.userTg || null,
    null, null, null, null, null,
    null, null, null, apt.createdAt,
  );
  return apt;
}

export async function getApts(ctx, cid) {
  if (!ctx?.db || !ctx?.tenantId) {
    const ids = (await kvGet(ctx, `ua:${cid}`)) || [];
    const all = await Promise.all(ids.map(id => kvGet(ctx, `ap:${id}`)));
    return all
      .map(normalizeAptDoc)
      .filter(a => a && !a.cx && a.status !== 'rejected' && a.ts > Date.now() - 3600000)
      .sort((a, b) => a.ts - b.ts);
  }
  const rows = await dbAll(ctx,
    "SELECT * FROM appointments WHERE tenant_id = ? AND chat_id = ? AND cancelled = 0 AND status != 'rejected' AND ts > ? ORDER BY ts",
    ctx.tenantId, cid, Date.now() - 3600000,
  );
  return rows.map(aptRowToDoc);
}

export async function getAdminAllApts(ctx) {
  if (!ctx?.db || !ctx?.tenantId) {
    const w = warsawNow();
    const monthKeys = [-2, -1, 0, 1].map(off => {
      const d = new Date(Date.UTC(w.year, w.month - 1 + off, 1));
      return allKey(`${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-01`);
    });
    const buckets = await Promise.all(monthKeys.map(k => kvGet(ctx, k)));
    const allIds = [...new Set(buckets.flatMap(b => b || []))];
    const apts = await Promise.all(allIds.map(id => kvGet(ctx, `ap:${id}`)));
    return apts
      .map(normalizeAptDoc)
      .filter(a => a && !a.cx && a.ts > Date.now() - CLEANUP_AFTER_MS)
      .sort((a, b) => a.ts - b.ts);
  }
  const rows = await dbAll(ctx,
    'SELECT * FROM appointments WHERE tenant_id = ? AND cancelled = 0 AND ts > ? ORDER BY ts',
    ctx.tenantId, Date.now() - CLEANUP_AFTER_MS,
  );
  return rows.map(aptRowToDoc);
}

export async function cancelApt(ctx, id, ownerChatId, adminOverride = false) {
  // Preview-mode: demo appointments use `demo_<rnd>` ids (no DB row); treat
  // cancel as a successful no-op so the UI flow still completes end-to-end.
  if (ctx?.previewMode) {
    return {
      id,
      chatId: ownerChatId,
      cx: true,
      cancelled: true,
      status: 'cancelled',
      cancelledBy: adminOverride ? 'admin' : 'client',
      cancelledAt: Math.floor(Date.now() / 1000),
      previewOnly: true,
    };
  }
  if (!/^a\d+_\w+$/.test(id)) return null;
  if (!ctx?.db || !ctx?.tenantId) {
    const a = normalizeAptDoc(await kvGet(ctx, `ap:${id}`));
    if (!a) return null;
    if (!adminOverride && a.chatId !== ownerChatId) return null;

    a.cx = true;
    a.cancelled = true;
    a.status = 'cancelled';
    a.cancelledBy = adminOverride ? 'admin' : 'client';
    a.cancelledAt = Math.floor(Date.now() / 1000);
    await kvPut(ctx, `ap:${id}`, a);

    if (a.googleEventId && (a.googleCalendarId || a.googleIntegrationId)) {
      await deleteAppointmentCalendar(ctx, a).catch(e =>
        console.error('cancelApt calendar delete error:', e.message),
      );
    }

    const ul = (await kvGet(ctx, `ua:${a.chatId}`)) || [];
    const newUl = ul.filter(x => x !== id);
    await Promise.all([
      kvPut(ctx, `ua:${a.chatId}`, newUl),
      removeFromIndexes(ctx, a),
    ]);
    return a;
  }

  const row = await dbGet(ctx, 'SELECT * FROM appointments WHERE id = ? AND tenant_id = ?', id, ctx.tenantId);
  if (!row) return null;
  const a = aptRowToDoc(row);
  if (!adminOverride && a.chatId !== ownerChatId) return null;

  const cancelledBy = adminOverride ? 'admin' : 'client';
  const cancelledAt = Math.floor(Date.now() / 1000);
  await dbRun(ctx,
    "UPDATE appointments SET cancelled = 1, status = 'cancelled', cancelled_by = ?, cancelled_at = ? WHERE id = ? AND tenant_id = ?",
    cancelledBy, cancelledAt, id, ctx.tenantId,
  );

  if (a.googleEventId && (a.googleCalendarId || a.googleIntegrationId)) {
    await deleteAppointmentCalendar(ctx, a).catch(e =>
      console.error('cancelApt calendar delete error:', e.message),
    );
  }

  a.cx = true;
  a.status = 'cancelled';
  a.cancelledBy = cancelledBy;
  a.cancelledAt = cancelledAt;
  return a;
}

/**
 * Check whether a candidate booking would conflict with existing appointments.
 * Extracted from getSlots() logic (Sprint 3 Section 9) so manual booking from
 * dashboard + AI BOOK_FOR_CLIENT action can share the same check.
 *
 * Back-to-back appointments are NOT considered a conflict (strict overlap).
 * Cancelled appointments do not block.
 *
 * @param {object} ctx - tenant ctx with svc + db
 * @param {string|number|null} masterId
 * @param {string} date - YYYY-MM-DD
 * @param {string} time - HH:MM
 * @param {string} svcId
 * @returns {Promise<{conflict: boolean, withAppointmentId?: string}>}
 */
export async function checkSlotConflict(ctx, masterId, date, time, svcId) {
  const svc = ctx.svc?.find(s => s.id === svcId);
  if (!svc) return { conflict: false };
  const [h, m] = String(time).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return { conflict: false };
  const candStart = h + m / 60;
  const candEnd = candStart + svc.dur / 60;

  const booked = await loadDayAppointments(ctx, date, masterId);
  const svcMap = new Map(ctx.svc.map(s => [s.id, s]));
  for (const a of booked) {
    if (a.cx || a.cancelled) continue;
    const bs = svcMap.get(a.svcId);
    if (!bs) continue;
    const [ah, am] = String(a.time).split(':').map(Number);
    const as = ah + am / 60;
    const ae = as + bs.dur / 60;
    // Strict overlap: candidate starts before booked ends AND candidate ends after booked starts
    if (candStart < ae && candEnd > as) {
      return { conflict: true, withAppointmentId: a.id };
    }
  }
  return { conflict: false };
}

export async function getSlots(ctx, date, svcId, masterId = null) {
  const svc = ctx.svc.find(s => s.id === svcId);
  if (!svc) return [];

  let workFrom = WORK.from, workTo = WORK.to;
  if (masterId != null) {
    const master = await getMaster(ctx, masterId);
    if (!master) return [];
    if (master.onVacation) return [];
    if (master.workHours?.from != null) workFrom = master.workHours.from;
    if (master.workHours?.to != null) workTo = master.workHours.to;
    if (Array.isArray(master.workDays) && master.workDays.length > 0) {
      const [y, mo, d] = date.split('-').map(Number);
      const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
      if (!master.workDays.includes(dow)) return [];
    }
  }

  const booked = await loadDayAppointments(ctx, date, masterId);
  const externalBusy = ctx?.db && ctx?.tenantId
    ? await loadExternalBusyBlocks(ctx, date, masterId)
    : [];
  const svcMap = new Map(ctx.svc.map(s => [s.id, s]));
  const td = todayStr();
  const w = warsawNow();
  const ch = w.hour, cm = w.minute;
  const slots = [];
  for (let h = workFrom; h < workTo; h++) {
    for (const m of [0, 30]) {
      const ss = h + m / 60, se = ss + svc.dur / 60;
      const slotStartMin = h * 60 + m;
      const slotEndMin = slotStartMin + svc.dur;
      if (se > workTo) continue;
      if (date === td && (h < ch || (h === ch && m <= cm))) continue;
      let ok = true;
      for (const a of booked) {
        const bs = svcMap.get(a.svcId);
        if (!bs) continue;
        const [ah, am] = a.time.split(':').map(Number);
        const as = ah + am / 60, ae = as + bs.dur / 60;
        if (ss < ae && se > as) { ok = false; break; }
      }
      if (ok) {
        for (const block of externalBusy) {
          if (externalBlockOverlapsSlot(date, slotStartMin, slotEndMin, block)) {
            ok = false;
            break;
          }
        }
      }
      if (ok) slots.push(`${p2(h)}:${p2(m)}`);
    }
  }
  return slots;
}

export async function getAllPendingApts(ctx) {
  if (!ctx?.db || !ctx?.tenantId) {
    const w = warsawNow();
    const monthKeys = [-1, 0, 1, 2].map(off => {
      const d = new Date(Date.UTC(w.year, w.month - 1 + off, 1));
      return allKey(`${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-01`);
    });
    const buckets = await Promise.all(monthKeys.map(k => kvGet(ctx, k)));
    const allIds = [...new Set(buckets.flatMap(b => b || []))];
    const apts = await Promise.all(allIds.map(id => kvGet(ctx, `ap:${id}`)));
    return apts
      .map(normalizeAptDoc)
      .filter(a => a && !a.cx && (a.status === 'pending' || a.status === 'counter_offer') && a.ts > Date.now() - 6 * 3600000)
      .sort((a, b) => a.ts - b.ts);
  }
  const rows = await dbAll(ctx,
    "SELECT * FROM appointments WHERE tenant_id = ? AND cancelled = 0 AND status IN ('pending', 'counter_offer') AND ts > ? ORDER BY ts",
    ctx.tenantId, Date.now() - 6 * 3600000,
  );
  return rows.map(aptRowToDoc);
}

/**
 * Update an appointment field directly in D1.
 */
export async function updateApt(ctx, aptId, updates) {
  if (!ctx?.db || !ctx?.tenantId) return null;
  const setClauses = [];
  const params = [];
  const fieldMap = {
    date: 'date', time: 'time', ts: 'ts',
    status: 'status', masterId: 'master_id', confirmedBy: 'confirmed_by',
    counterTime: 'counter_time', counterComment: 'counter_comment',
    rejectComment: 'reject_comment', cancelReason: 'cancel_reason',
    cancelled: 'cancelled', cx: 'cancelled',
    googleEventId: 'google_event_id', googleCalendarId: 'google_calendar_id',
    googleIntegrationId: 'google_integration_id',
  };
  const remFields = { 'rem.h24': 'rem_h24', 'rem.h2': 'rem_h2' };
  for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
    if (jsKey in updates) {
      let val = updates[jsKey];
      if (jsKey === 'cx' || jsKey === 'cancelled') val = val ? 1 : 0;
      setClauses.push(`${dbCol} = ?`);
      params.push(val);
    }
  }
  if (updates.rem) {
    if ('h24' in updates.rem) { setClauses.push('rem_h24 = ?'); params.push(updates.rem.h24 ? 1 : 0); }
    if ('h2' in updates.rem) { setClauses.push('rem_h2 = ?'); params.push(updates.rem.h2 ? 1 : 0); }
  }
  if (setClauses.length === 0) return null;
  params.push(aptId, ctx.tenantId);
  await dbRun(ctx, `UPDATE appointments SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?`, ...params);
  const row = await dbGet(ctx, 'SELECT * FROM appointments WHERE id = ? AND tenant_id = ?', aptId, ctx.tenantId);
  return aptRowToDoc(row);
}

export async function getAptById(ctx, aptId) {
  if (!ctx?.db || !ctx?.tenantId) return null;
  const row = await dbGet(ctx, 'SELECT * FROM appointments WHERE id = ? AND tenant_id = ?', aptId, ctx.tenantId);
  return aptRowToDoc(row);
}

/**
 * Look up an appointment by ID without tenant scoping.
 * Used exclusively by the calendar HTTP handler where the HMAC signature
 * already authenticates the request, so tenant constraint is unnecessary.
 * The appointment ID (a<timestamp>_<random>) is globally unique.
 */
export async function getAptByIdGlobal(ctx, aptId) {
  if (!ctx?.db) return null;
  const row = await dbGet(ctx, 'SELECT * FROM appointments WHERE id = ?', aptId);
  return aptRowToDoc(row);
}
