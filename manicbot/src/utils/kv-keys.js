/**
 * KV key registry — all key patterns used in the project.
 *
 * Centralizes magic strings so typos are caught at import time
 * and key patterns are discoverable via "Find All References".
 *
 * Prefixes: All tenant-scoped keys are auto-prefixed with `ctx.prefix`
 * by kvGet/kvPut/kvDel in `kv.js`. Keys here are the suffix part.
 * Global keys (no prefix) are used directly on `ctx.globalKv` or `ctx.kv`.
 */

// ── Tenant-scoped keys (auto-prefixed by ctx.prefix) ──────────
/** Chat conversation history — `chat:{chatId}` */
export const chatKey = cid => `chat:${cid}`;
/** User language — `lang:{chatId}` (stored as plain text, not JSON) */
export const langKey = cid => `lang:${cid}`;
/** Conversation state — `st:{chatId}` */
export const stateKey = cid => `st:${cid}`;
/** Per-user rate limit — `rl:{chatId}` */
export const rateLimitKey = cid => `rl:${cid}`;
/** Admin chat ID config — `cfg:admin` */
export const ADMIN_CONFIG_KEY = 'cfg:admin';
/** Master profile — `master:{chatId}` */
export const masterKey = cid => `master:${cid}`;
/** Master index — `master:__index` */
export const MASTER_INDEX_KEY = 'master:__index';
/** Blocked user flag — `blocked:{chatId}` */
export const blockedKey = cid => `blocked:${cid}`;
/** User profile — `u:{chatId}` */
export const userKey = cid => `u:${cid}`;
/** Appointment — `ap:{aptId}` */
export const aptKey = id => `ap:${id}`;
/** User appointments list — `ua:{chatId}` */
export const userAptsKey = cid => `ua:${cid}`;
/** Day slot index — `d:{date}` */
export const dayKey = date => `d:${date}`;
/** Monthly appointment index — `all:{YYYY-MM}` */
export const monthKey = ym => `all:${ym}`;
/** Slot lock — `lock:slot:{date}:{time}` */
export const slotLockKey = (date, time) => `lock:slot:${date}:${time}`;
/** Ticket forward ack — `ticket_fwd_ack:{chatId}` */
export const ticketFwdAckKey = cid => `ticket_fwd_ack:${cid}`;

// ── Prefix constants for kvListAll ────────────────────────────
export const MASTER_PREFIX = 'master:';
export const USER_PREFIX = 'u:';

// ── Global keys (no tenant prefix) ───────────────────────────
/** Bot token in KV — `bottoken:{botId}` */
export const botTokenKey = botId => `bottoken:${botId}`;
/** Stripe webhook dedup — `stripe:evt:{eventId}` */
export const stripeEvtKey = eventId => `stripe:evt:${eventId}`;
/** Google OAuth session — `gcal:oauth:{sessionId}` */
export const oauthSessionKey = sessionId => `gcal:oauth:${sessionId}`;
/** Google Calendar access token cache — `gcal:access_token` */
export const GCAL_TOKEN_CACHE_KEY = 'gcal:access_token';
/** Platform ticket lock — `tktlock:{ticketId}` */
export const ticketLockKey = ticketId => `tktlock:${ticketId}`;
/** Admin event log — `adminlog:recent` */
export const ADMIN_LOG_KEY = 'adminlog:recent';
/** KV→D1 migration flag — `migration:v1:done` */
export const MIGRATION_FLAG = 'migration:v1:done';
/** Search rate limit — `rl:search:{ip}` */
export const searchRlKey = ip => `rl:search:${ip}`;
