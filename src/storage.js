// ══════════════════════════════════════════════════════════════
// Tenant-scoped KV storage (booking, user, state, lang)
// Uses keys from keys.js; ctx must have ctx.kv and ctx.tenantId
// ══════════════════════════════════════════════════════════════

import { MAX_APTS, VALID_LANGS } from './constants.js';
import {
  userKey,
  userAptsKey,
  stateKey,
  langKey,
  aptKey,
  dayKey,
  monthKey,
  monthFromDate,
  lockKey,
} from './keys.js';

async function kvGet(ctx, fullKey) {
  try {
    return await ctx.kv.get(fullKey, 'json');
  } catch (e) {
    console.error('KV GET fail:', fullKey, e?.message);
    return null;
  }
}

async function kvPut(ctx, fullKey, v, opts = {}) {
  try {
    await ctx.kv.put(fullKey, JSON.stringify(v), opts);
    return true;
  } catch (e) {
    console.error('KV PUT fail:', fullKey, e?.message);
    return false;
  }
}

async function kvDel(ctx, fullKey) {
  try {
    await ctx.kv.delete(fullKey);
  } catch (e) {
    console.error('KV DEL fail:', fullKey, e?.message);
  }
}

const t = (ctx) => ctx.tenantId ?? '';

export async function getLang(ctx, cid) {
  try {
    const v = await ctx.kv.get(langKey(t(ctx), cid));
    return v || null;
  } catch {
    return null;
  }
}

export async function setLang(ctx, cid, lang) {
  if (!VALID_LANGS.has(lang)) return;
  try {
    await ctx.kv.put(langKey(t(ctx), cid), lang);
  } catch (_) {}
}

export async function getState(ctx, cid) {
  const s = await kvGet(ctx, stateKey(t(ctx), cid));
  return s || { step: 'idle' };
}

export async function setState(ctx, cid, state, expirationTtl = 7200) {
  await kvPut(ctx, stateKey(t(ctx), cid), state, { expirationTtl });
}

export async function clearState(ctx, cid) {
  await kvDel(ctx, stateKey(t(ctx), cid));
}

export async function getUser(ctx, cid) {
  return kvGet(ctx, userKey(t(ctx), cid));
}

export async function saveUser(ctx, cid, data) {
  await kvPut(ctx, userKey(t(ctx), cid), data);
}

export async function saveApt(ctx, apt) {
  const tid = t(ctx);
  const uaKey = userAptsKey(tid, apt.chatId);
  const ul = (await kvGet(ctx, uaKey)) || [];

  const existing = await Promise.all(ul.map((id) => kvGet(ctx, aptKey(tid, id))));
  const active = existing.filter((a) => a && !a.cx && a.ts > Date.now()).length;
  if (active >= MAX_APTS) return null;

  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(36)).join('').slice(0, 8);
  const id = `a${Date.now()}_${rnd}`;
  apt.id = id;
  apt.createdAt = Date.now();
  apt.rem = { h24: false, h12: false, h1: false };

  const m = monthFromDate(apt.date);
  const [dl, al] = await Promise.all([
    kvGet(ctx, dayKey(tid, apt.date)),
    kvGet(ctx, monthKey(tid, m)),
  ]);

  const dayList = dl || [];
  const monthList = al || [];
  ul.push(id);
  dayList.push(id);
  monthList.push(id);

  await Promise.all([
    kvPut(ctx, aptKey(tid, id), apt),
    kvPut(ctx, uaKey, ul),
    kvPut(ctx, dayKey(tid, apt.date), dayList),
    kvPut(ctx, monthKey(tid, m), monthList),
  ]);

  return apt;
}

export async function getApts(ctx, cid) {
  const tid = t(ctx);
  const ids = (await kvGet(ctx, userAptsKey(tid, cid))) || [];
  const all = await Promise.all(ids.map((id) => kvGet(ctx, aptKey(tid, id))));
  return all
    .filter((a) => a && !a.cx && a.ts > Date.now() - 3600000)
    .sort((a, b) => a.ts - b.ts);
}

export async function cancelApt(ctx, aptId, ownerChatId) {
  if (!/^a\d+_\w+$/.test(aptId)) return null;
  const tid = t(ctx);
  const a = await kvGet(ctx, aptKey(tid, aptId));
  if (!a || a.chatId !== ownerChatId) return null;
  a.cx = true;
  await kvPut(ctx, aptKey(tid, aptId), a);

  const m = monthFromDate(a.date);
  const [dl, ul, al] = await Promise.all([
    kvGet(ctx, dayKey(tid, a.date)),
    kvGet(ctx, userAptsKey(tid, ownerChatId)),
    kvGet(ctx, monthKey(tid, m)),
  ]);

  const newDl = (dl || []).filter((x) => x !== aptId);
  const newUl = (ul || []).filter((x) => x !== aptId);
  const newAl = (al || []).filter((x) => x !== aptId);

  await Promise.all([
    newDl.length === 0 ? kvDel(ctx, dayKey(tid, a.date)) : kvPut(ctx, dayKey(tid, a.date), newDl),
    kvPut(ctx, userAptsKey(tid, ownerChatId), newUl),
    newAl.length === 0 ? kvDel(ctx, monthKey(tid, m)) : kvPut(ctx, monthKey(tid, m), newAl),
  ]);

  return a;
}

export async function getSlots(ctx, date, svcId, config) {
  const svc = config.services.find((s) => s.id === svcId);
  if (!svc) return [];
  const tid = t(ctx);
  const ids = (await kvGet(ctx, dayKey(tid, date))) || [];
  const fetched = await Promise.all(ids.map((id) => kvGet(ctx, aptKey(tid, id))));
  const booked = fetched.filter((a) => a && !a.cx);
  const svcMap = new Map(config.services.map((s) => [s.id, s]));
  return { svc, booked, svcMap };
}

/** Get lock key for idempotency; caller does kvGet/kvPut. */
export function getLockKey(ctx, cid, date, time) {
  return lockKey(t(ctx), cid, date, time);
}

export async function kvGetApt(ctx, aptId) {
  return kvGet(ctx, aptKey(t(ctx), aptId));
}

export async function kvPutApt(ctx, aptId, apt) {
  return kvPut(ctx, aptKey(t(ctx), aptId), apt);
}

/** List all tenant-scoped keys (for admin/cron). prefix = tenant:{tenantId}: */
export function tenantListPrefix(tenantId) {
  return `tenant:${tenantId}:`;
}

/** Get day keys for a date (for cron reminders). */
export function getDayKey(ctx, date) {
  return dayKey(t(ctx), date);
}

/** Get month key for yyyy-mm. */
export function getMonthKey(ctx, yyyyMm) {
  return monthKey(t(ctx), yyyyMm);
}

export { kvGet, kvPut, kvDel };
