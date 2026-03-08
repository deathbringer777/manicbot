import { kvGet, kvPut, kvDel, kvListAll } from '../utils/kv.js';
import { isValidChatId } from '../utils/helpers.js';
import { api } from '../telegram.js';
import { resolveRole, ROLES } from '../roles/roles.js';

export async function getAdminId(ctx) { return kvGet(ctx, 'cfg:admin'); }
export async function setAdminId(ctx, cid) { return kvPut(ctx, 'cfg:admin', cid); }
export async function isAdmin(ctx, cid) { return (await getAdminId(ctx)) === cid; }

export async function getMaster(ctx, cid) { return kvGet(ctx, `master:${cid}`); }

export async function saveMaster(ctx, cid, data) {
  data.services = data.services || null;
  data.workHours = data.workHours || null;
  data.workDays = data.workDays || null;
  data.onVacation = data.onVacation === true;
  return kvPut(ctx, `master:${cid}`, data);
}

export async function deleteMaster(ctx, cid) { await kvDel(ctx, `master:${cid}`); }
export async function isMaster(ctx, cid) { return !!(await getMaster(ctx, cid)); }

export async function listMasters(ctx) {
  const keys = await kvListAll(ctx, { prefix: 'master:' });
  const masters = [];
  for (const k of keys) {
    const m = await kvGet(ctx, k.name);
    if (m) masters.push(m);
  }
  return masters;
}

export function normalizeUsername(raw) {
  const uname = String(raw || '').trim().replace(/^@+/, '');
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(uname)) return null;
  return uname.toLowerCase();
}

export function normalizePhone(raw) {
  const cleaned = String(raw || '').replace(/[^\d+]/g, '').slice(0, 20);
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return { cleaned, digits };
}

export async function findUserByUsername(ctx, username) {
  const uname = normalizeUsername(username);
  if (!uname) return null;
  const keys = await kvListAll(ctx, { prefix: 'u:' });
  for (const k of keys) {
    const u = await kvGet(ctx, k.name);
    if (!u?.tgUsername) continue;
    if (normalizeUsername(u.tgUsername) === uname) return u;
  }
  return null;
}

export async function findUserByPhone(ctx, phoneRaw) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return null;
  const keys = await kvListAll(ctx, { prefix: 'u:' });
  for (const k of keys) {
    const u = await kvGet(ctx, k.name);
    if (!u?.phone) continue;
    const userPhone = normalizePhone(u.phone);
    if (userPhone && userPhone.digits === phone.digits) return u;
  }
  return null;
}

export async function resolveMasterInput(ctx, msg, txt) {
  let masterId = null;
  let masterName = '?';
  let masterUsername = null;
  let masterPhone = null;

  if (msg.forward_from) {
    masterId = msg.forward_from.id;
    masterName = [msg.forward_from.first_name, msg.forward_from.last_name].filter(Boolean).join(' ') || '?';
    masterUsername = msg.forward_from.username || null;
    return { masterId, masterName, masterUsername, masterPhone };
  }

  if (msg.contact) {
    if (msg.contact.user_id && isValidChatId(msg.contact.user_id)) {
      masterId = msg.contact.user_id;
      masterName = [msg.contact.first_name, msg.contact.last_name].filter(Boolean).join(' ') || '?';
      masterPhone = normalizePhone(msg.contact.phone_number || '')?.cleaned || null;
      return { masterId, masterName, masterUsername, masterPhone };
    }
    const byContactPhone = await findUserByPhone(ctx, msg.contact.phone_number || '');
    if (byContactPhone?.chatId) {
      return {
        masterId: byContactPhone.chatId,
        masterName: byContactPhone.name || '?',
        masterUsername: byContactPhone.tgUsername || null,
        masterPhone: normalizePhone(byContactPhone.phone || '')?.cleaned || null,
      };
    }
  }

  const parsed = parseInt(txt, 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    masterId = parsed;
    masterName = `User ${parsed}`;
    return { masterId, masterName, masterUsername, masterPhone };
  }

  const username = normalizeUsername(txt);
  if (username) {
    const chatByUsername = await api(ctx, 'getChat', { chat_id: '@' + username });
    if (chatByUsername?.ok && isValidChatId(chatByUsername.result?.id)) {
      const r = chatByUsername.result;
      return {
        masterId: r.id,
        masterName: [r.first_name, r.last_name].filter(Boolean).join(' ') || (r.username ? '@' + r.username : '?'),
        masterUsername: r.username || username,
        masterPhone: null,
      };
    }
    const byUsername = await findUserByUsername(ctx, username);
    if (byUsername?.chatId) {
      return {
        masterId: byUsername.chatId,
        masterName: byUsername.name || (byUsername.tgUsername ? '@' + byUsername.tgUsername : '?'),
        masterUsername: byUsername.tgUsername || username,
        masterPhone: normalizePhone(byUsername.phone || '')?.cleaned || null,
      };
    }
  }

  const phone = normalizePhone(txt);
  if (phone) {
    const byPhone = await findUserByPhone(ctx, phone.cleaned);
    if (byPhone?.chatId) {
      return {
        masterId: byPhone.chatId,
        masterName: byPhone.name || '?',
        masterUsername: byPhone.tgUsername || null,
        masterPhone: normalizePhone(byPhone.phone || '')?.cleaned || phone.cleaned,
      };
    }
  }

  return { masterId: null, masterName: '?', masterUsername: null, masterPhone: null };
}

/** Returns 'admin' | 'master' | 'support' | 'client' for backward compat with UI. */
export async function getRole(ctx, cid) {
  if (ctx.globalKv && ctx.prefix) {
    const role = await resolveRole(ctx.globalKv, ctx, cid);
    if (role === ROLES.SYSTEM_ADMIN || role === ROLES.TENANT_OWNER) return 'admin';
    if (role === ROLES.SUPPORT) return 'support';
    if (role === ROLES.MASTER) return 'master';
    if (role === ROLES.CLIENT && (await isAdmin(ctx, cid))) return 'admin';
    return 'client';
  }
  if (await isAdmin(ctx, cid)) return 'admin';
  if (await isMaster(ctx, cid)) return 'master';
  return 'client';
}

export async function isBlocked(ctx, cid) { return !!(await kvGet(ctx, `blocked:${cid}`)); }
export async function blockUser(ctx, cid) { await kvPut(ctx, `blocked:${cid}`, true); }
export async function unblockUser(ctx, cid) { await kvDel(ctx, `blocked:${cid}`); }
export async function canManageApt(ctx, cid) { return (await isAdmin(ctx, cid)) || (await isMaster(ctx, cid)); }

export async function getUser(ctx, cid) { return kvGet(ctx, `u:${cid}`); }
export async function saveUser(ctx, cid, d) { await kvPut(ctx, `u:${cid}`, d); }
