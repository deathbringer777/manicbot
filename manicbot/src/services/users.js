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
    /**
     * 0072 — real Telegram chat_id when the master was paired via
     * `/start mst_<token>` (web-created synthetic masters). NULL for
     * masters whose primary `chat_id` is already a real TG chat
     * (origin='invited_telegram' or pre-0023 legacy rows).
     */
    telegramChatId: row.telegram_chat_id ?? null,
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

/**
 * Returns the Telegram chat_id to send messages / notifications to for
 * a given master. Prefer `telegram_chat_id` (real TG account paired by
 * the master via /start mst_<token>) over the primary `chat_id` which
 * may be a synthetic >=10B identity for web-created salon masters.
 *
 * Returns null when the master has neither (cannot be messaged via TG).
 *
 * @param {object|null} master  master doc from `masterRowToDoc` or KV
 * @returns {number|null}
 */
export function masterTelegramRecipient(master) {
  if (!master) return null;
  const tg = master.telegramChatId ?? master.telegram_chat_id ?? null;
  if (tg) return Number(tg);
  // Synthetic chat_ids live in the 10B+ range — see migration 0023. If we
  // have no `telegram_chat_id`, a synthetic primary chat_id is NOT a
  // valid TG recipient (Telegram API will 400).
  const cid = Number(master.chatId);
  if (Number.isFinite(cid) && cid > 0 && cid < 10_000_000_000) return cid;
  return null;
}

export async function getMaster(ctx, cid) {
  if (!ctx?.db || !ctx?.tenantId) return kvGet(ctx, `master:${cid}`);
  // 0072 — match EITHER the master's primary `chat_id` (legacy + real-TG
  // masters) OR `telegram_chat_id` (web-created synthetic masters paired
  // via /start mst_<token>). The partial UNIQUE index
  // `idx_masters_tenant_tg_chat` guarantees at most one master row per
  // (tenant_id, telegram_chat_id), so the OR can match at most one row.
  // Archived masters are intentionally NOT filtered here — callers that
  // need active-only (e.g. tenant_owner master list, public profile) add
  // their own `archived_at IS NULL` check.
  const row = await dbGet(
    ctx,
    'SELECT * FROM masters WHERE tenant_id = ? AND (chat_id = ? OR telegram_chat_id = ?)',
    ctx.tenantId, cid, cid,
  );
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
    if (role === ROLES.TENANT_OWNER) return 'tenant_owner';
    if (role === ROLES.TENANT_MANAGER) return 'tenant_manager';
    if (role === ROLES.SUPPORT) return 'support';
    if (role === ROLES.MASTER) return 'master';
    if (role === ROLES.CLIENT && String(await getAdminId(ctx)) === String(cid)) return 'tenant_owner';
    return 'client';
  }
  if (await isAdmin(ctx, cid)) return 'tenant_owner';
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
  return {
    chatId: row.chat_id, name: row.name, tgUsername: row.tg_username, tgLang: row.tg_lang,
    phone: row.phone, registeredAt: row.registered_at, tosAcceptedAt: row.tos_accepted_at,
    // 0109: email + marketing linkage + opt-in state, used by the chat
    // email-capture flow to gate prompts and run spontaneous capture without
    // a second query. Additive — existing callers destructure a subset.
    email: row.email ?? null, marketingContactId: row.marketing_contact_id ?? null,
    emailOptIn: row.email_opt_in ?? null, emailPromptLastAt: row.email_prompt_last_at ?? null,
    emailPromptCount: row.email_prompt_count ?? 0,
  };
}

/**
 * 0074 — return the favorite-master chat id for this user in the current
 * tenant, or null if neither a manual pin nor a derived favorite exists.
 *
 * Lookup order (mirrors admin-app `clients.getFavoriteMasterSuggestion`):
 *   1. `users.favorite_master_id` — explicit pin set by the salon owner
 *      in the Client modal. Skipped if the pinned master is archived.
 *   2. Most-frequent `master_id` across this user's non-cancelled
 *      appointments. Top-1 by visit count, skipping archived masters.
 *
 * Returns null when:
 *   - The Worker has no D1 binding (legacy KV-only context).
 *   - The user has no rows for either lookup.
 *   - All candidates resolve to archived / missing masters.
 *
 * Cross-channel: identity collapses to one (tenant_id, chat_id) row.
 * The same Telegram chat id resolves through phone/email match if the
 * salon staff manually linked them in the dashboard.
 */
export async function getFavoriteMasterId(ctx, cid) {
  if (!ctx?.db || !ctx?.tenantId) return null;
  // 1. Manual pin.
  const pinRow = await dbGet(
    ctx,
    'SELECT favorite_master_id FROM users WHERE tenant_id = ? AND chat_id = ?',
    ctx.tenantId, cid,
  );
  const pinned = pinRow?.favorite_master_id ?? null;
  if (pinned != null) {
    const m = await dbGet(
      ctx,
      'SELECT chat_id, archived_at FROM masters WHERE tenant_id = ? AND chat_id = ?',
      ctx.tenantId, pinned,
    );
    if (m && m.archived_at == null) return Number(m.chat_id);
  }
  // 2. Derived from history. We pull every non-cancelled (tenant, chat,
  // master) row and aggregate in JS instead of using GROUP BY — the
  // per-client appointment count is small (tens, maybe hundreds of rows
  // over a lifetime), and the in-JS aggregation keeps us portable to the
  // mock D1 used in tests (which doesn't parse GROUP BY). One row per
  // appointment scans the existing idx_apt_tenant_chat index.
  const rows = await dbAll(
    ctx,
    `SELECT master_id FROM appointments
      WHERE tenant_id = ? AND chat_id = ? AND cancelled = 0 AND master_id IS NOT NULL`,
    ctx.tenantId, cid,
  );
  const counts = new Map();
  for (const r of rows) {
    const mid = Number(r.master_id);
    if (!Number.isFinite(mid)) continue;
    counts.set(mid, (counts.get(mid) ?? 0) + 1);
  }
  const ranked = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [mid] of ranked) {
    const m = await dbGet(
      ctx,
      'SELECT chat_id, archived_at FROM masters WHERE tenant_id = ? AND chat_id = ?',
      ctx.tenantId, mid,
    );
    if (m && m.archived_at == null) return Number(m.chat_id);
  }
  return null;
}

export async function saveUser(ctx, cid, d) {
  if (!ctx?.db || !ctx?.tenantId) {
    await kvPut(ctx, `u:${cid}`, d);
    return;
  }
  // Upsert ONLY the registration fields. This used to be INSERT OR REPLACE,
  // which re-creates the whole row and silently wiped every other column
  // (email, dob, notes, tags, marketing_contact_id, first_source, avatars,
  // email_opt_in…) whenever a registered client re-/start-ed the bot. The
  // ON CONFLICT upsert mutates the existing row in place, leaving those
  // columns untouched. Email + opt-in are written by captureChatEmail /
  // setChatEmailOptOut, never here.
  await dbRun(ctx,
    `INSERT INTO users (tenant_id, chat_id, name, tg_username, tg_lang, phone, registered_at, tos_accepted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, chat_id) DO UPDATE SET
       name = excluded.name,
       tg_username = excluded.tg_username,
       tg_lang = excluded.tg_lang,
       phone = excluded.phone,
       registered_at = excluded.registered_at,
       tos_accepted_at = excluded.tos_accepted_at`,
    ctx.tenantId, cid, d.name || null, d.tgUsername || null, d.tgLang || null, d.phone || null, d.registeredAt || null, d.tosAcceptedAt || null,
  );
}

/**
 * Returns true iff the user has completed the minimum registration for
 * booking: a real name (not the 'User'/'?' placeholders we used to write)
 * AND a phone number. Used by the booking flow to decide whether to gate
 * a user through REG_NAME → REG_PHONE before showing the confirmation
 * card. On web the /start handler no longer auto-populates name, but
 * historical rows may still carry 'User' — this helper also treats those
 * as incomplete.
 * @param {object|null} user
 * @returns {boolean}
 */
export function isRegComplete(user) {
  if (!user) return false;
  const name = typeof user.name === 'string' ? user.name.trim() : '';
  const phone = typeof user.phone === 'string' ? user.phone.trim() : '';
  if (!name || !phone) return false;
  if (name === '?' || name === '—' || name === '-') return false;
  // 'User' was the old fallback we wrote for synthetic web inbound payloads;
  // treat it as incomplete so legacy sessions are re-registered properly.
  if (name === 'User') return false;
  return true;
}

/**
 * DSR (GDPR right-of-access) helper: list `web_users` rows in a
 * privacy-safe shape, filtered by tenant_id OR email.
 *
 * EXCLUDES (never returned, even to the platform admin running the export):
 *   * password_hash
 *   * verification_token, password_reset_token, login_token_hash,
 *     email_change_token (all token fields)
 *   * verification_token_expires_at, password_reset_expires_at,
 *     email_change_token_expires_at, login_token_expires_at
 *   * new_email (pending email change is in-flight state, not access data)
 *   * login_attempts, locked_until (anti-abuse counters)
 *   * password_changed_at, sessions_invalidated_at (security state)
 *   * referral_source, referral_note (internal lead-source attribution)
 *   * tos_accepted_at (audit field; surfaced separately if needed)
 *
 * INCLUDES (the seven DSR fields):
 *   id, email, tenant_id, role, created_at, email_verified,
 *   last_login_at, last_login_ip
 *
 * `last_login_ip` is the only IP field returned (the user already saw their
 * own IP in login-alert emails; treat it as the user's own data).
 *
 * @param {object} ctx - Worker ctx with ctx.db bound.
 * @param {{ tenantId?: string|null, email?: string|null }} filter
 * @returns {Promise<Array<{
 *   id: string,
 *   email: string,
 *   tenant_id: string|null,
 *   role: string,
 *   created_at: number,
 *   email_verified: number,
 *   last_login_at: number|null,
 *   last_login_ip: string|null,
 * }>>}
 */
export async function listWebUsersForDsr(ctx, filter = {}) {
  if (!ctx?.db) return [];
  const tenantId = filter.tenantId != null ? String(filter.tenantId).trim() : '';
  const email = filter.email != null ? String(filter.email).trim().toLowerCase() : '';
  // Require at least one filter: this export is privacy-sensitive even for
  // platform admins, and dumping the full table would be footgun-shaped.
  if (!tenantId && !email) return [];

  const cols = `
    id, email, tenant_id, role, created_at, email_verified,
    last_login_at, last_login_ip
  `;
  let rows;
  if (tenantId && email) {
    rows = await dbAll(
      ctx,
      `SELECT ${cols} FROM web_users WHERE tenant_id = ? AND LOWER(email) = ? ORDER BY created_at`,
      tenantId, email,
    );
  } else if (tenantId) {
    rows = await dbAll(
      ctx,
      `SELECT ${cols} FROM web_users WHERE tenant_id = ? ORDER BY created_at`,
      tenantId,
    );
  } else {
    rows = await dbAll(
      ctx,
      `SELECT ${cols} FROM web_users WHERE LOWER(email) = ? ORDER BY created_at`,
      email,
    );
  }
  return rows || [];
}

export async function upsertUserFromTelegram(ctx, cid, from) {
  if (!cid || !from) return;
  // Compose the real name only from the parts actually provided. Do NOT
  // fall back to the literal string 'User' — that value is meaningless,
  // indistinguishable from a real registration, and defeats the
  // `isRegComplete` gate (web sessions used to end up with name='User'
  // even though the visitor never typed anything).
  const composed = [from.first_name, from.last_name].filter(Boolean).join(' ').trim().slice(0, 100);
  const name = composed || null;
  const tgUsername = from.username ? String(from.username).trim().slice(0, 32) : null;

  const existing = await getUser(ctx, cid);
  // Preserve any existing values; only fill gaps with the new data. Never
  // overwrite a real name with null, and never downgrade 'Анна' to 'User'.
  const payload = {
    chatId: cid,
    name: existing?.name || name || null,
    tgUsername: tgUsername || existing?.tgUsername || null,
    tgLang: existing?.tgLang || null,
    phone: existing?.phone || null,
    registeredAt: existing?.registeredAt || null,
  };
  await saveUser(ctx, cid, payload);
}
