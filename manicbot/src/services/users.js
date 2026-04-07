import { kvGet, kvPut, kvDel, kvListAll } from '../utils/kv.js';
import { dbGet, dbAll, dbRun } from '../utils/db.js';
import { nowSec } from '../utils/time.js';
import { isValidChatId } from '../utils/helpers.js';
import { api } from '../telegram.js';
import { resolveRole, getPlatformRole, ROLES } from '../roles/roles.js';

export async function getAdminId(ctx) {
  if (!ctx?.db || !ctx?.tenantId) return kvGet(ctx, 'cfg:admin');
  const row = await dbGet(ctx, "SELECT value FROM tenant_config WHERE tenant_id = ? AND key = 'admin'", ctx.tenantId);
  return row?.value ? JSON.parse(row.value) : null;
}

export async function setAdminId(ctx, cid) {
  if (!ctx?.db || !ctx?.tenantId) return kvPut(ctx, 'cfg:admin', cid);
  await dbRun(ctx,
    "INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, 'admin', ?)",
    ctx.tenantId, JSON.stringify(cid),
  );
  return true;
}

export function isCreator(ctx, cid) {
  if (!ctx?.adminChatId || cid == null) return false;
  return String(ctx.adminChatId) === String(cid);
}

/**
 * SECURITY: returns true if `cid` is the active web session's chat_id and the
 * ctx is locked to the client role. Used by `isAdmin`, `isPlatformAdmin`,
 * `getRole`, and `resolveRole` (in roles.js) to refuse any privilege
 * escalation for web-channel users — even if their hashed chat_id collides
 * with a real admin row in tenant_roles / platform_roles.
 *
 * The marker `_lockToClientRole = true` + `_webSessionChatId = chatId` is set
 * by chatWebHttp.js immediately after `buildChannelCtx`.
 */
export function isWebSessionLocked(ctx, cid) {
  if (!ctx?._lockToClientRole) return false;
  if (ctx._webSessionChatId == null) return false;
  if (cid == null) return false;
  return Number(cid) === Number(ctx._webSessionChatId);
}

export async function isAdmin(ctx, cid) {
  // SECURITY: web-channel sessions are NEVER admins, even with a stale role row.
  if (isWebSessionLocked(ctx, cid)) return false;
  if (isCreator(ctx, cid)) return true;
  if (ctx.db) {
    if (ctx.tenantId) {
      const role = await resolveRole(ctx, cid);
      if (role === ROLES.SYSTEM_ADMIN || role === ROLES.TENANT_OWNER) return true;
      if (role === ROLES.SUPPORT || role === ROLES.MASTER) return false;
    } else {
      const platformRole = await getPlatformRole(ctx, cid);
      if (platformRole === ROLES.SYSTEM_ADMIN && isCreator(ctx, cid)) return true;
      if (platformRole === ROLES.SUPPORT) return false;
    }
  }
  return String(await getAdminId(ctx)) === String(cid);
}

export async function isPlatformAdmin(ctx, cid) {
  // SECURITY: web-channel sessions are NEVER platform admins.
  if (isWebSessionLocked(ctx, cid)) return false;
  if (isCreator(ctx, cid)) return true;
  if (!ctx.db) return false;
  const platformRole = await getPlatformRole(ctx, cid);
  return platformRole === ROLES.SYSTEM_ADMIN && isCreator(ctx, cid);
}

// ── Masters ─────────────────────────────────────────────────────────────────

const MASTER_INDEX_KEY = 'master:__index';

async function getMasterIndex(ctx) {
  const idx = await kvGet(ctx, MASTER_INDEX_KEY);
  return Array.isArray(idx) ? idx : [];
}

function masterRowToDoc(row) {
  if (!row) return null;
  return {
    chatId: row.chat_id,
    name: row.name,
    tgUsername: row.tg_username,
    services: row.services ? JSON.parse(row.services) : null,
    workHours: row.work_hours ? JSON.parse(row.work_hours) : null,
    workDays: row.work_days ? JSON.parse(row.work_days) : null,
    onVacation: row.on_vacation === 1,
    active: row.active === 1,
    addedAt: row.added_at,
    googleCalendarId: row.google_calendar_id,
    calendarEnabled: row.calendar_enabled === 1,
  };
}

export async function getMaster(ctx, cid) {
  if (!ctx?.db || !ctx?.tenantId) return kvGet(ctx, `master:${cid}`);
  const row = await dbGet(ctx, 'SELECT * FROM masters WHERE tenant_id = ? AND chat_id = ?', ctx.tenantId, cid);
  return masterRowToDoc(row);
}

export async function saveMaster(ctx, cid, data) {
  if (!ctx?.db || !ctx?.tenantId) {
    const payload = {
      ...data,
      services: data.services || null,
      workHours: data.workHours || null,
      workDays: data.workDays || null,
      onVacation: data.onVacation === true,
    };
    await kvPut(ctx, `master:${cid}`, payload);
    const idx = await getMasterIndex(ctx);
    if (!idx.includes(cid)) {
      idx.push(cid);
      await kvPut(ctx, MASTER_INDEX_KEY, idx);
    }
    return;
  }
  await dbRun(ctx,
    `INSERT OR REPLACE INTO masters (tenant_id, chat_id, name, tg_username, services, work_hours, work_days, on_vacation, active, added_at, google_calendar_id, calendar_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ctx.tenantId, cid,
    data.name || null,
    data.tgUsername || null,
    data.services ? JSON.stringify(data.services) : null,
    data.workHours ? JSON.stringify(data.workHours) : null,
    data.workDays ? JSON.stringify(data.workDays) : null,
    data.onVacation === true ? 1 : 0,
    data.active === false ? 0 : 1,
    data.addedAt || nowSec(),
    data.googleCalendarId || null,
    data.calendarEnabled ? 1 : 0,
  );
}

export async function deleteMaster(ctx, cid) {
  if (!ctx?.db || !ctx?.tenantId) {
    await kvDel(ctx, `master:${cid}`);
    const idx = (await getMasterIndex(ctx)).filter(id => id !== cid);
    await kvPut(ctx, MASTER_INDEX_KEY, idx);
    return;
  }
  await dbRun(ctx, 'DELETE FROM masters WHERE tenant_id = ? AND chat_id = ?', ctx.tenantId, cid);
}

export async function isMaster(ctx, cid) { return !!(await getMaster(ctx, cid)); }

export async function listMasters(ctx) {
  if (!ctx?.db || !ctx?.tenantId) {
    const idx = await kvGet(ctx, MASTER_INDEX_KEY);
    if (Array.isArray(idx)) {
      const masters = [];
      for (const cid of idx) {
        const master = await kvGet(ctx, `master:${cid}`);
        if (master) masters.push(master);
      }
      return masters;
    }
    const keys = await kvListAll(ctx, { prefix: 'master:' });
    const masters = [];
    for (const key of keys) {
      if (key.name === MASTER_INDEX_KEY) continue;
      const master = await kvGet(ctx, key.name);
      if (master) masters.push(master);
    }
    return masters;
  }
  const rows = await dbAll(ctx, 'SELECT * FROM masters WHERE tenant_id = ?', ctx.tenantId);
  return rows.map(masterRowToDoc).filter(Boolean);
}

// ── User lookup ─────────────────────────────────────────────────────────────

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
  if (ctx?.db && ctx?.tenantId) {
    const row = await dbGet(ctx,
      'SELECT * FROM users WHERE tenant_id = ? AND LOWER(tg_username) = ?',
      ctx.tenantId, uname,
    );
    return row ? { chatId: row.chat_id, name: row.name, tgUsername: row.tg_username, tgLang: row.tg_lang, phone: row.phone, registeredAt: row.registered_at } : null;
  }
  const keys = await kvListAll(ctx, { prefix: 'u:' });
  for (const key of keys) {
    const user = await kvGet(ctx, key.name);
    if (!user?.tgUsername) continue;
    if (normalizeUsername(user.tgUsername) === uname) return user;
  }
  return null;
}

export async function findUserByPhone(ctx, phoneRaw) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return null;
  if (ctx?.db && ctx?.tenantId) {
    const rows = await dbAll(ctx,
      'SELECT * FROM users WHERE tenant_id = ? AND phone IS NOT NULL',
      ctx.tenantId,
    );
    for (const row of rows) {
      const userPhone = normalizePhone(row.phone);
      if (userPhone && userPhone.digits === phone.digits) {
        return { chatId: row.chat_id, name: row.name, tgUsername: row.tg_username, tgLang: row.tg_lang, phone: row.phone, registeredAt: row.registered_at };
      }
    }
  }
  const keys = await kvListAll(ctx, { prefix: 'u:' });
  for (const key of keys) {
    const user = await kvGet(ctx, key.name);
    if (!user?.phone) continue;
    const userPhone = normalizePhone(user.phone);
    if (userPhone && userPhone.digits === phone.digits) return user;
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
    if (msg.from && normalizeUsername(msg.from.username) === username) {
      return {
        masterId: msg.from.id,
        masterName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || (msg.from.username ? '@' + msg.from.username : '?'),
        masterUsername: msg.from.username || username,
        masterPhone: null,
      };
    }
    // getChat is Telegram-only — skip on WA/IG (fallback to DB lookup below)
    const chatByUsername = (!ctx.channel || ctx.channel.type === 'telegram')
      ? await api(ctx, 'getChat', { chat_id: '@' + username })
      : null;
    if (chatByUsername?.ok && isValidChatId(chatByUsername.result?.id)) {
      const r = chatByUsername.result;
      return {
        masterId: r.id,
        masterName: [r.first_name, r.last_name].filter(Boolean).join(' ') || (r.username ? '@' + username : '?'),
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

export async function getRole(ctx, cid) {
  // SECURITY: web-channel sessions are ALWAYS clients. Force the lowest
  // privilege regardless of any tenant_roles / platform_roles row that might
  // happen to share this hashed chat_id.
  if (isWebSessionLocked(ctx, cid)) return 'client';
  if (isCreator(ctx, cid)) return 'system_admin';
  if (ctx.db && ctx.tenantId) {
    const role = await resolveRole(ctx, cid);
    if (role === ROLES.SYSTEM_ADMIN) return 'system_admin';
    if (role === ROLES.TENANT_OWNER) return 'admin';
    if (role === ROLES.SUPPORT) return 'support';
    if (role === ROLES.MASTER) return 'master';
    if (role === ROLES.CLIENT && String(await getAdminId(ctx)) === String(cid)) return 'admin';
    return 'client';
  }
  if (await isAdmin(ctx, cid)) return 'admin';
  if (await isMaster(ctx, cid)) return 'master';
  return 'client';
}

// ── Blocked users (D1) ──────────────────────────────────────────────────────

export async function isBlocked(ctx, cid) {
  if (!ctx?.db || !ctx?.tenantId) return !!(await kvGet(ctx, `blocked:${cid}`));
  const row = await dbGet(ctx, 'SELECT 1 FROM blocked_users WHERE tenant_id = ? AND chat_id = ?', ctx.tenantId, cid);
  return !!row;
}

export async function blockUser(ctx, cid) {
  if (!ctx?.db || !ctx?.tenantId) {
    await kvPut(ctx, `blocked:${cid}`, true);
    return;
  }
  await dbRun(ctx, 'INSERT OR IGNORE INTO blocked_users (tenant_id, chat_id) VALUES (?, ?)', ctx.tenantId, cid);
}

export async function unblockUser(ctx, cid) {
  if (!ctx?.db || !ctx?.tenantId) {
    await kvDel(ctx, `blocked:${cid}`);
    return;
  }
  await dbRun(ctx, 'DELETE FROM blocked_users WHERE tenant_id = ? AND chat_id = ?', ctx.tenantId, cid);
}

export async function canManageApt(ctx, cid) { return (await isAdmin(ctx, cid)) || (await isMaster(ctx, cid)); }

// ── User CRUD (D1) ─────────────────────────────────────────────────────────

export async function getUser(ctx, cid) {
  if (!ctx?.db || !ctx?.tenantId) return kvGet(ctx, `u:${cid}`);
  const row = await dbGet(ctx, 'SELECT * FROM users WHERE tenant_id = ? AND chat_id = ?', ctx.tenantId, cid);
  if (!row) return null;
  return { chatId: row.chat_id, name: row.name, tgUsername: row.tg_username, tgLang: row.tg_lang, phone: row.phone, registeredAt: row.registered_at, tosAcceptedAt: row.tos_accepted_at };
}

export async function saveUser(ctx, cid, d) {
  if (!ctx?.db || !ctx?.tenantId) {
    await kvPut(ctx, `u:${cid}`, d);
    return;
  }
  await dbRun(ctx,
    `INSERT OR REPLACE INTO users (tenant_id, chat_id, name, tg_username, tg_lang, phone, registered_at, tos_accepted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ctx.tenantId, cid, d.name || null, d.tgUsername || null, d.tgLang || null, d.phone || null, d.registeredAt || null, d.tosAcceptedAt || null,
  );
}

export async function upsertUserFromTelegram(ctx, cid, from) {
  if (!cid || !from) return;
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ').trim().slice(0, 100) || 'User';
  const tgUsername = from.username ? String(from.username).trim().slice(0, 32) : null;

  const existing = await getUser(ctx, cid);
  const payload = {
    chatId: cid,
    name: existing?.name || name,
    tgUsername: tgUsername || existing?.tgUsername || null,
    tgLang: existing?.tgLang || null,
    phone: existing?.phone || null,
    registeredAt: existing?.registeredAt || null,
  };
  await saveUser(ctx, cid, payload);
}
