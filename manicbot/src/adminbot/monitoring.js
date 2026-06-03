/**
 * Admin/ops bot — cross-tenant ("God Mode") monitoring reads.
 *
 * Every query here is intentionally CROSS-TENANT (no tenant_id filter on the
 * aggregates) — that is the whole point of the platform-owner bot. This is the
 * one legitimate place that omits tenant scoping; functions are named to make
 * that explicit and the bot's owner-only gate (handler.isAdminAuthorized) is
 * the access control. Per-tenant detail queries (in lookupTenant) DO bind the
 * looked-up tenant_id.
 *
 * All time windows are ROLLING (last-24h / last-7d) using epoch-second cutoffs
 * for registered_at / created_at; appointment windows use the Warsaw calendar
 * `date` TEXT column (avoids the appointments.ts millisecond ambiguity).
 * Owner-facing metrics exclude tenants.is_test = 1 so seeded demo accounts
 * don't skew the numbers.
 */
import { dbGet, dbAll } from '../utils/db.js';
import { escHtml } from '../utils/helpers.js';
import { todayStr, dateStrForOffset } from '../utils/date.js';
import { getBotToken } from '../tenant/storage.js';
import { log } from '../utils/logger.js';

/** Monthly plan prices in PLN — mirrors admin-app/src/lib/money.ts PLAN_PRICES. */
export const PLAN_PRICES = { start: 45, pro: 60, max: 90 };

/** Max bots to probe in a single /bots health check. Bounds the concurrent
 *  getWebhookInfo subrequests so we stay well under the Worker subrequest cap. */
const BOT_HEALTH_PROBE_CAP = 40;

function epochDaysAgo(n) {
  return Math.floor(Date.now() / 1000) - n * 86400;
}

function fmtTs(sec) {
  if (!sec) return '—';
  try { return new Date(Number(sec) * 1000).toISOString().slice(0, 16).replace('T', ' '); }
  catch { return '—'; }
}

/** Escape LIKE wildcards so a user query can't turn into a wildcard scan. */
export function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, (c) => '\\' + c);
}

/** Pure MRR sum from an active-plan distribution [{plan, n}]. */
export function computeMrr(planDist) {
  let mrr = 0;
  for (const row of planDist || []) {
    const price = PLAN_PRICES[row.plan];
    if (price) mrr += price * Number(row.n || 0);
  }
  return mrr;
}

// ── Fetchers ────────────────────────────────────────────────────────────────

export async function getPlatformStats(ctx) {
  const active = await dbGet(ctx, 'SELECT COUNT(*) AS n FROM tenants WHERE active = 1 AND is_test = 0');
  const trialing = await dbGet(ctx, "SELECT COUNT(*) AS n FROM tenants WHERE billing_status = 'trialing' AND is_test = 0");
  const planDist = await dbAll(ctx, "SELECT plan, COUNT(*) AS n FROM tenants WHERE billing_status = 'active' AND is_test = 0 GROUP BY plan");
  const newTen = await dbGet(ctx, 'SELECT COUNT(*) AS n FROM tenants WHERE is_test = 0 AND created_at >= ?', epochDaysAgo(7));
  const payingTotal = (planDist || []).reduce((s, r) => s + Number(r.n || 0), 0);
  return {
    activeTenants: active?.n ?? 0,
    trialing: trialing?.n ?? 0,
    planDist: planDist || [],
    payingTotal,
    mrr: computeMrr(planDist),
    newTenants7d: newTen?.n ?? 0,
  };
}

export async function getSignups(ctx) {
  // tenant-scan-ignore: cross-tenant platform metric for the owner-only admin/ops bot (God Mode; gated by ADMIN_CHAT_ID)
  const u24 = await dbGet(ctx, 'SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL AND registered_at >= ?', epochDaysAgo(1));
  // tenant-scan-ignore: cross-tenant platform metric for the owner-only admin/ops bot (God Mode; gated by ADMIN_CHAT_ID)
  const u7 = await dbGet(ctx, 'SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL AND registered_at >= ?', epochDaysAgo(7));
  const t24 = await dbGet(ctx, 'SELECT COUNT(*) AS n FROM tenants WHERE is_test = 0 AND created_at >= ?', epochDaysAgo(1));
  const t7 = await dbGet(ctx, 'SELECT COUNT(*) AS n FROM tenants WHERE is_test = 0 AND created_at >= ?', epochDaysAgo(7));
  return { users24h: u24?.n ?? 0, users7d: u7?.n ?? 0, newTenants24h: t24?.n ?? 0, newTenants7d: t7?.n ?? 0 };
}

export async function getAppts(ctx) {
  const today = todayStr();
  const weekEnd = dateStrForOffset(6);
  // tenant-scan-ignore: cross-tenant platform metric for the owner-only admin/ops bot (God Mode; gated by ADMIN_CHAT_ID)
  const td = await dbGet(ctx, 'SELECT COUNT(*) AS n FROM appointments WHERE cancelled = 0 AND date = ?', today);
  // tenant-scan-ignore: cross-tenant platform metric for the owner-only admin/ops bot (God Mode; gated by ADMIN_CHAT_ID)
  const up = await dbGet(ctx, 'SELECT COUNT(*) AS n FROM appointments WHERE cancelled = 0 AND date >= ? AND date <= ?', today, weekEnd);
  // tenant-scan-ignore: cross-tenant platform metric for the owner-only admin/ops bot (God Mode; gated by ADMIN_CHAT_ID)
  const created7 = await dbGet(ctx, 'SELECT COUNT(*) AS n FROM appointments WHERE created_at >= ?', epochDaysAgo(7));
  return { today: td?.n ?? 0, upcoming7d: up?.n ?? 0, created7d: created7?.n ?? 0 };
}

export async function getErrors(ctx, severity = '') {
  const bySeverity = await dbAll(ctx, "SELECT severity, COUNT(*) AS n, SUM(count) AS total FROM error_events WHERE status = 'open' GROUP BY severity");
  let recent;
  if (severity) {
    recent = await dbAll(ctx, "SELECT id, severity, title, message, count, last_seen, source FROM error_events WHERE status = 'open' AND severity = ? ORDER BY last_seen DESC LIMIT 10", severity);
  } else {
    recent = await dbAll(ctx, "SELECT id, severity, title, message, count, last_seen, source FROM error_events WHERE status = 'open' ORDER BY last_seen DESC LIMIT 10");
  }
  return { bySeverity: bySeverity || [], recent: recent || [] };
}

/** Probe each active bot's webhook; flag any with an empty `url` (the known
 *  "silent bot = unset webhook" failure mode). */
export async function getBotHealth(ctx) {
  const count = await dbGet(ctx, 'SELECT COUNT(*) AS n FROM bots WHERE active = 1');
  // tenant-scan-ignore: cross-tenant bot inventory for the owner-only admin/ops bot (God Mode; gated by ADMIN_CHAT_ID)
  const rows = await dbAll(ctx, 'SELECT bot_id, tenant_id, bot_username FROM bots WHERE active = 1 LIMIT ?', BOT_HEALTH_PROBE_CAP);
  // Probe concurrently (bounded by the cap) so wall-clock is one timeout, not N.
  const probes = await Promise.all(rows.map(async (b) => {
    let token = null;
    try { token = await getBotToken(ctx, b.bot_id, ctx.BOT_ENCRYPTION_KEY || null); }
    catch { token = null; }
    if (!token) return { tokenError: true };
    const info = await getWebhookInfoForToken(token);
    const silent = info && !info.url
      ? { botId: b.bot_id, tenantId: b.tenant_id, username: b.bot_username, lastError: info.last_error_message || null }
      : null;
    return { silent };
  }));
  const silent = probes.map((p) => p.silent).filter(Boolean);
  const tokenErrors = probes.filter((p) => p.tokenError).length;
  const checked = probes.length - tokenErrors;
  return { activeBots: count?.n ?? 0, probed: rows.length, checked, tokenErrors, capped: (count?.n ?? 0) > BOT_HEALTH_PROBE_CAP, silent };
}

export async function getWebhookInfoForToken(token) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { signal: AbortSignal.timeout(8000) });
    const d = await r.json().catch(() => ({}));
    return d?.result || null;
  } catch (e) {
    log.error('adminbot.webhookInfo', e instanceof Error ? e : new Error(String(e?.message)));
    return null;
  }
}

export async function lookupTenant(ctx, query) {
  const q = String(query || '').trim();
  if (!q) return { matches: [], detail: null };
  const like = '%' + escapeLike(q) + '%';
  const matches = await dbAll(
    ctx,
    "SELECT id, name, slug, plan, billing_status, trial_ends_at, created_at FROM tenants WHERE is_test = 0 AND (name LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\' OR id = ?) ORDER BY created_at DESC LIMIT 10",
    like, like, q,
  );
  let detail = null;
  if (matches.length === 1) {
    const id = matches[0].id;
    const bots = await dbAll(ctx, 'SELECT bot_id, bot_username, active FROM bots WHERE tenant_id = ?', id);
    const appts = await dbGet(ctx, 'SELECT COUNT(*) AS total, SUM(CASE WHEN cancelled = 0 THEN 1 ELSE 0 END) AS active_apts FROM appointments WHERE tenant_id = ?', id);
    detail = { bots: bots || [], appts: appts || { total: 0, active_apts: 0 } };
  }
  return { matches: matches || [], detail };
}

export async function getAiUsage(ctx) {
  const since = dateStrForOffset(-6); // last 7 calendar days (usage_date is YYYY-MM-DD)
  const row = await dbGet(ctx, 'SELECT SUM(tokens_in) AS tin, SUM(tokens_out) AS tout, SUM(model_calls) AS calls FROM ai_usage WHERE usage_date >= ?', since);
  return { tokensIn: row?.tin ?? 0, tokensOut: row?.tout ?? 0, calls: row?.calls ?? 0, since };
}

// ── Renderers (HTML; dynamic values escaped) ─────────────────────────────────

export function renderStats(s) {
  const plans = (s.planDist || []).map((p) => `${escHtml(p.plan || '—')}: ${p.n}`).join(', ') || '—';
  return [
    '📊 <b>Платформа</b>',
    `• Активных салонов: <b>${s.activeTenants}</b>`,
    `• На триале: ${s.trialing}`,
    `• Платящих: ${s.payingTotal} (${plans})`,
    `• MRR: <b>${s.mrr} PLN</b>`,
    `• Новых салонов за 7д: ${s.newTenants7d}`,
  ].join('\n');
}

export function renderSignups(s) {
  return [
    '🆕 <b>Регистрации</b>',
    `• Клиентов за 24ч: <b>${s.users24h}</b> / за 7д: ${s.users7d}`,
    `• Салонов за 24ч: ${s.newTenants24h} / за 7д: ${s.newTenants7d}`,
  ].join('\n');
}

export function renderAppts(s) {
  return [
    '📅 <b>Записи</b>',
    `• На сегодня: <b>${s.today}</b>`,
    `• Ближайшие 7д: ${s.upcoming7d}`,
    `• Создано за 7д: ${s.created7d}`,
  ].join('\n');
}

export function renderMrr(s) {
  const plans = (s.planDist || []).map((p) => `  • ${escHtml(p.plan || '—')}: ${p.n} × ${PLAN_PRICES[p.plan] ?? '?'} PLN`).join('\n') || '  —';
  return ['💰 <b>MRR</b>', `Итого: <b>${s.mrr} PLN/мес</b>`, 'Разбивка (активные):', plans].join('\n');
}

export function renderErrors(e) {
  const lines = ['🚨 <b>Ошибки (open)</b>'];
  if (!e.bySeverity.length) { lines.push('Открытых ошибок нет ✅'); return lines.join('\n'); }
  lines.push(e.bySeverity.map((r) => `${escHtml(r.severity)}: ${r.n} (события: ${r.total ?? r.n})`).join(' · '));
  lines.push('', '<b>Последние:</b>');
  for (const r of e.recent.slice(0, 10)) {
    const ttl = escHtml(String(r.title || r.message || '').slice(0, 120));
    lines.push(`• [${escHtml(r.severity)}] ${ttl} ×${r.count} — ${escHtml(r.source || '?')} (${fmtTs(r.last_seen)})`);
  }
  return lines.join('\n');
}

export function renderBotHealth(b) {
  const lines = ['🤖 <b>Здоровье ботов</b>', `• Активных ботов: <b>${b.activeBots}</b> (проверено ${b.checked})`];
  if (b.tokenErrors) lines.push(`• Не удалось расшифровать токен: ${b.tokenErrors}`);
  if (b.capped) lines.push(`• ⚠️ Проверены первые ${b.probed} (всего больше)`);
  if (!b.silent.length) lines.push('• Молчащих ботов (без вебхука) нет ✅');
  else {
    lines.push(`• ⚠️ <b>Молчащих ботов: ${b.silent.length}</b> (вебхук не установлен):`);
    for (const s of b.silent.slice(0, 20)) {
      lines.push(`   — ${escHtml(s.username || s.botId)} (tenant ${escHtml(String(s.tenantId || '—'))})${s.lastError ? ' · ' + escHtml(String(s.lastError).slice(0, 60)) : ''}`);
    }
  }
  return lines.join('\n');
}

export function renderTenant(r) {
  if (!r.matches.length) return '🔎 Салон не найден.';
  if (r.matches.length > 1) {
    const lines = [`🔎 Найдено ${r.matches.length}:`];
    for (const m of r.matches) lines.push(`• <b>${escHtml(m.name || m.id)}</b> — ${escHtml(m.plan || '—')}/${escHtml(m.billing_status || '—')} <code>${escHtml(m.id)}</code>`);
    lines.push('', 'Уточни запрос для деталей по одному салону.');
    return lines.join('\n');
  }
  const m = r.matches[0];
  const lines = [
    `🔎 <b>${escHtml(m.name || m.id)}</b>`,
    `• ID: <code>${escHtml(m.id)}</code>${m.slug ? ` · slug: ${escHtml(m.slug)}` : ''}`,
    `• План: ${escHtml(m.plan || '—')} / ${escHtml(m.billing_status || '—')}`,
    `• Триал до: ${fmtTs(m.trial_ends_at)} · создан: ${fmtTs(m.created_at)}`,
  ];
  if (r.detail) {
    const bots = r.detail.bots.map((b) => `${escHtml(b.bot_username || b.bot_id)}${b.active ? '' : ' (off)'}`).join(', ') || '—';
    lines.push(`• Боты: ${bots}`);
    lines.push(`• Записи: всего ${r.detail.appts.total ?? 0}, активных ${r.detail.appts.active_apts ?? 0}`);
  }
  return lines.join('\n');
}

export function renderAiUsage(u) {
  return [
    '📈 <b>AI usage (7д)</b>',
    `• Вызовов модели: ${u.calls}`,
    `• Токенов in/out: ${u.tokensIn} / ${u.tokensOut}`,
    `• С даты: ${escHtml(u.since)}`,
  ].join('\n');
}
