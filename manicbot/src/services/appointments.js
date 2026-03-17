import { WORK, MAX_APTS, CLEANUP_AFTER_MS } from '../config.js';
import { kvGet, kvPut, kvDel } from '../utils/kv.js';
import { p2 } from '../utils/helpers.js';
import { warsawNow, warsawToUTC, todayStr } from '../utils/date.js';
import { deleteCalendarEvent } from './calendar.js';

export function allKey(dateStr) {
  return `all:${dateStr.slice(0, 7)}`;
}

export function dayIndexKey(date, masterId = null) {
  return `d:${date}`;
}

export function getAptMasterId(apt) { return apt?.masterId || null; }
export function isSharedApt(apt) { return !apt?.masterId; }

export async function loadDayAppointments(ctx, date, masterId = null) {
  const ids = (await kvGet(ctx, dayIndexKey(date, masterId))) || [];
  const fetched = await Promise.all(ids.map(id => kvGet(ctx, `ap:${id}`)));
  return fetched.filter(a => a && !a.cx);
}

export async function addToIndexes(ctx, apt) {
  const monthKey = allKey(apt.date);
  const dKey = dayIndexKey(apt.date, getAptMasterId(apt));
  const [dl, al] = await Promise.all([kvGet(ctx, dKey), kvGet(ctx, monthKey)]);
  const newDl = dl || []; newDl.push(apt.id);
  const newAl = al || []; newAl.push(apt.id);
  await Promise.all([
    kvPut(ctx, dKey, newDl),
    kvPut(ctx, monthKey, newAl),
  ]);
}

export async function removeFromIndexes(ctx, apt) {
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

export async function saveApt(ctx, apt) {
  const ul = (await kvGet(ctx, `ua:${apt.chatId}`)) || [];
  const existing = await Promise.all(ul.map(id => kvGet(ctx, `ap:${id}`)));
  const active = existing.filter(a => a && !a.cx && a.ts > Date.now()).length;
  if (active >= MAX_APTS) return null;

  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(36)).join('').slice(0, 8);
  const id = `a${Date.now()}_${rnd}`;
  apt.id = id;
  apt.masterId = apt.masterId || null;
  apt.status = 'pending';
  apt.createdAt = Date.now();
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

export async function getApts(ctx, cid) {
  const ids = (await kvGet(ctx, `ua:${cid}`)) || [];
  const all = await Promise.all(ids.map(id => kvGet(ctx, `ap:${id}`)));
  return all
    .filter(a => a && !a.cx && a.status !== 'rejected' && a.ts > Date.now() - 3600000)
    .sort((a, b) => a.ts - b.ts);
}

export async function getAdminAllApts(ctx) {
  const w = warsawNow();
  const monthKeys = [-2, -1, 0, 1].map(off => {
    const d = new Date(Date.UTC(w.year, w.month - 1 + off, 1));
    return `all:${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
  });
  const buckets = await Promise.all(monthKeys.map(k => kvGet(ctx, k)));
  const allIds = [...new Set(buckets.flatMap(b => b || []))];
  const apts = await Promise.all(allIds.map(id => kvGet(ctx, `ap:${id}`)));
  return apts.filter(a => a && !a.cx && a.ts > Date.now() - CLEANUP_AFTER_MS).sort((a, b) => a.ts - b.ts);
}

export async function cancelApt(ctx, id, ownerChatId, adminOverride = false) {
  if (!/^a\d+_\w+$/.test(id)) return null;
  const a = await kvGet(ctx, `ap:${id}`);
  if (!a) return null;
  if (!adminOverride && a.chatId !== ownerChatId) return null;
  a.cx = true;
  a.status = 'cancelled';
  await kvPut(ctx, `ap:${id}`, a);

  // Google Calendar: delete event if linked
  if (a.googleEventId && a.googleCalendarId) {
    deleteCalendarEvent(ctx, a.googleCalendarId, a.googleEventId).catch(e =>
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

export async function getSlots(ctx, date, svcId, masterId = null) {
  const svc = ctx.svc.find(s => s.id === svcId);
  if (!svc) return [];
  const booked = await loadDayAppointments(ctx, date, masterId);
  const svcMap = new Map(ctx.svc.map(s => [s.id, s]));
  const td = todayStr();
  const w = warsawNow();
  const ch = w.hour, cm = w.minute;
  const slots = [];
  for (let h = WORK.from; h < WORK.to; h++) {
    for (const m of [0, 30]) {
      const ss = h + m / 60, se = ss + svc.dur / 60;
      if (se > WORK.to) continue;
      if (date === td && (h < ch || (h === ch && m <= cm))) continue;
      let ok = true;
      for (const a of booked) {
        const bs = svcMap.get(a.svcId);
        if (!bs) continue;
        const [ah, am] = a.time.split(':').map(Number);
        const as = ah + am / 60, ae = as + bs.dur / 60;
        if (ss < ae && se > as) { ok = false; break; }
      }
      if (ok) slots.push(`${p2(h)}:${p2(m)}`);
    }
  }
  return slots;
}

export async function getAllPendingApts(ctx) {
  const w = warsawNow();
  const monthKeys = [-1, 0, 1, 2].map(off => {
    const d = new Date(Date.UTC(w.year, w.month - 1 + off, 1));
    return `all:${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
  });
  const buckets = await Promise.all(monthKeys.map(k => kvGet(ctx, k)));
  const allIds = [...new Set(buckets.flatMap(b => b || []))];
  const apts = (await Promise.all(allIds.map(id => kvGet(ctx, `ap:${id}`))))
    .filter(a => a && !a.cx && (a.status === 'pending' || a.status === 'counter_offer') && a.ts > Date.now() - 6 * 3600000)
    .sort((a, b) => a.ts - b.ts);
  return apts;
}
