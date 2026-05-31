/**
 * platformCampaignStats — per-tenant monthly report content for the
 * `monthly_report` platform campaign, plus the localized renderers used by the
 * dispatch (report + subscription reminder) to produce per-channel bodies.
 *
 * UNIT CONTRACT (locked by tests): appointments.ts is MILLISECONDS;
 * users.registered_at / thread_messages.created_at / appointments.created_at /
 * appointments.cancelled_at are SECONDS. The month window exposes both.
 * Every query is tenant-scoped (ctx.tenantId) and respects soft-deletes.
 */

import { dbGet, dbAll } from '../utils/db.js';
import { warsawToUTC } from '../utils/date.js';

const LOCALE_TAG = { ru: 'ru', ua: 'uk', uk: 'uk', en: 'en', pl: 'pl' };

function nextMonth(year, month) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/**
 * [start, end) bounds of a 'YYYY-MM' period in the platform timezone, in both
 * ms (for appointments.ts) and sec (for *_at columns).
 */
export function monthWindow(periodYM) {
  const [y, m] = String(periodYM).split('-').map(Number);
  const startMs = warsawToUTC(y, m, 1, 0, 0).getTime();
  const nm = nextMonth(y, m);
  const endMs = warsawToUTC(nm.year, nm.month, 1, 0, 0).getTime();
  return {
    year: y, month: m,
    startMs, endMs,
    startSec: Math.floor(startMs / 1000),
    endSec: Math.floor(endMs / 1000),
  };
}

async function countOne(ctx, sql, ...args) {
  const row = await dbGet(ctx, sql, ...args).catch(() => null);
  return Number(row?.c ?? 0);
}

/**
 * Compute the previous-month stats for the current tenant (ctx.tenantId).
 * `periodYM` is the report month ('YYYY-MM') — i.e. the campaign occurrence.
 */
export async function buildMonthlyReport(ctx, periodYM) {
  const w = monthWindow(periodYM);
  const tid = ctx.tenantId;

  const booked = await countOne(ctx,
    'SELECT COUNT(*) AS c FROM appointments WHERE tenant_id = ? AND created_at >= ? AND created_at < ?',
    tid, w.startSec, w.endSec);
  const completed = await countOne(ctx,
    "SELECT COUNT(*) AS c FROM appointments WHERE tenant_id = ? AND status = 'done' AND ts >= ? AND ts < ?",
    tid, w.startMs, w.endMs);
  const cancelled = await countOne(ctx,
    'SELECT COUNT(*) AS c FROM appointments WHERE tenant_id = ? AND cancelled = 1 AND COALESCE(cancelled_at, created_at) >= ? AND COALESCE(cancelled_at, created_at) < ?',
    tid, w.startSec, w.endSec);
  const newClients = await countOne(ctx,
    'SELECT COUNT(*) AS c FROM users WHERE tenant_id = ? AND deleted_at IS NULL AND registered_at >= ? AND registered_at < ?',
    tid, w.startSec, w.endSec);
  const messages = await countOne(ctx,
    'SELECT COUNT(*) AS c FROM thread_messages WHERE tenant_id = ? AND deleted_at IS NULL AND created_at >= ? AND created_at < ?',
    tid, w.startSec, w.endSec);
  const activeMasters = await countOne(ctx,
    'SELECT COUNT(*) AS c FROM masters WHERE tenant_id = ? AND active = 1 AND archived_at IS NULL AND is_synthetic = 0',
    tid);

  // Completed-visit service breakdown → top service + estimated revenue.
  // Aggregate in JS (no GROUP BY): prices live in ctx.svc, not in D1.
  const doneRows = await dbAll(ctx,
    "SELECT svc_id FROM appointments WHERE tenant_id = ? AND status = 'done' AND ts >= ? AND ts < ?",
    tid, w.startMs, w.endMs).catch(() => []);
  const priceMap = new Map((ctx.svc || []).map((s) => [s.id, Number(s.price) || 0]));
  const nameMap = new Map((ctx.svc || []).map((s) => [s.id, (s.names && (s.names.ru || s.names.en)) || s.id]));
  const counts = new Map();
  let estimatedRevenue = 0;
  let hasPrices = false;
  for (const r of doneRows) {
    counts.set(r.svc_id, (counts.get(r.svc_id) || 0) + 1);
    if (priceMap.has(r.svc_id)) { estimatedRevenue += priceMap.get(r.svc_id); hasPrices = true; }
  }
  let topService = null;
  for (const [id, c] of counts) {
    if (!topService || c > topService.count) topService = { id, name: nameMap.get(id) || id, count: c };
  }

  return {
    periodYM, year: w.year, month: w.month,
    booked, completed, cancelled, newClients, messages, activeMasters,
    topService,
    estimatedRevenue: hasPrices ? estimatedRevenue : null,
  };
}

// ─── Localized copy ───────────────────────────────────────────────────────

const COPY = {
  ru: {
    reportTitle: (mon) => `Итоги за ${mon}`,
    intro: 'Краткая сводка по вашему салону за прошлый месяц.',
    labels: { booked: 'Записей создано', completed: 'Визитов завершено', cancelled: 'Отмен', newClients: 'Новых клиентов', messages: 'Сообщений в чатах', masters: 'Активных мастеров', topService: 'Топ-услуга', revenue: 'Оценочная выручка' },
    reportCta: 'Открыть аналитику',
    footer: 'ManicBot — платформа для салонов красоты',
    reminder: { title: 'Скоро продление подписки', titleCancel: 'Подписка скоро завершится', intro: (d) => `Ваша подписка ManicBot продлится ${d}.`, introCancel: (d) => `Ваша подписка ManicBot завершится ${d}.`, hint: 'Проверьте способ оплаты, чтобы избежать перерыва в работе.', cta: 'Управление подпиской' },
  },
  ua: {
    reportTitle: (mon) => `Підсумки за ${mon}`,
    intro: 'Коротка зведення по вашому салону за минулий місяць.',
    labels: { booked: 'Записів створено', completed: 'Візитів завершено', cancelled: 'Скасувань', newClients: 'Нових клієнтів', messages: 'Повідомлень у чатах', masters: 'Активних майстрів', topService: 'Топ-послуга', revenue: 'Оцінкова виручка' },
    reportCta: 'Відкрити аналітику',
    footer: 'ManicBot — платформа для салонів краси',
    reminder: { title: 'Скоро продовження підписки', titleCancel: 'Підписка скоро завершиться', intro: (d) => `Ваша підписка ManicBot продовжиться ${d}.`, introCancel: (d) => `Ваша підписка ManicBot завершиться ${d}.`, hint: 'Перевірте спосіб оплати, щоб уникнути перерви в роботі.', cta: 'Керування підпискою' },
  },
  en: {
    reportTitle: (mon) => `${mon} summary`,
    intro: 'A quick summary of your salon for the past month.',
    labels: { booked: 'Bookings created', completed: 'Visits completed', cancelled: 'Cancellations', newClients: 'New clients', messages: 'Chat messages', masters: 'Active staff', topService: 'Top service', revenue: 'Estimated revenue' },
    reportCta: 'Open analytics',
    footer: 'ManicBot — beauty salon platform',
    reminder: { title: 'Subscription renews soon', titleCancel: 'Subscription ends soon', intro: (d) => `Your ManicBot subscription renews on ${d}.`, introCancel: (d) => `Your ManicBot subscription ends on ${d}.`, hint: 'Check your payment method to avoid interruption.', cta: 'Manage subscription' },
  },
  pl: {
    reportTitle: (mon) => `Podsumowanie: ${mon}`,
    intro: 'Krótkie podsumowanie Twojego salonu za miniony miesiąc.',
    labels: { booked: 'Utworzonych rezerwacji', completed: 'Zakończonych wizyt', cancelled: 'Anulowań', newClients: 'Nowych klientów', messages: 'Wiadomości na czacie', masters: 'Aktywnych pracowników', topService: 'Najczęstsza usługa', revenue: 'Szacowany przychód' },
    reportCta: 'Otwórz analitykę',
    footer: 'ManicBot — platforma dla salonów kosmetycznych',
    reminder: { title: 'Subskrypcja wkrótce się odnowi', titleCancel: 'Subskrypcja wkrótce się kończy', intro: (d) => `Twoja subskrypcja ManicBot odnowi się ${d}.`, introCancel: (d) => `Twoja subskrypcja ManicBot kończy się ${d}.`, hint: 'Sprawdź metodę płatności, aby uniknąć przerwy.', cta: 'Zarządzaj subskrypcją' },
  },
};

function copyFor(locale) {
  return COPY[locale === 'uk' ? 'ua' : locale] || COPY.ru;
}

function monthLabel(year, month, locale) {
  const tag = LOCALE_TAG[locale] || 'ru';
  const s = new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function appBase(ctx) {
  return ((ctx?.APP_BASE_URL || ctx?.appBaseUrl || '').replace(/\/$/, '')) || 'https://manicbot.com';
}

// ─── Minimal inline-styled email layout (mirrors billing email look) ────────

function emailLayout(heading, innerHtml, footer) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0e1a;padding:40px 16px;"><tr><td align="center">
<table width="100%" style="max-width:520px;background-color:#111827;border-radius:16px;border:1px solid rgba(255,255,255,0.06);overflow:hidden;">
<tr><td style="padding:32px 32px 0;text-align:center;">
<div style="display:inline-block;width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#06b6d4);text-align:center;line-height:48px;font-size:20px;font-weight:800;color:#fff;">M</div>
<h1 style="margin:16px 0 0;font-size:22px;font-weight:700;color:#ffffff;">${esc(heading)}</h1></td></tr>
<tr><td style="padding:24px 32px 32px;">${innerHtml}</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;"><p style="margin:0;font-size:12px;color:#64748b;">${esc(footer)}</p></td></tr>
</table></td></tr></table></body></html>`;
}

function statsTableHtml(rows) {
  const body = rows.map(([k, v], i) => {
    const border = i < rows.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.06);' : '';
    return `<tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;${border}">${esc(k)}</td><td style="padding:8px 12px;font-size:13px;color:#e2e8f0;text-align:right;${border}">${esc(String(v))}</td></tr>`;
  }).join('');
  return `<table style="margin:8px 0;width:100%;border-collapse:collapse;">${body}</table>`;
}

function ctaHtml(url, text) {
  return `<div style="text-align:center;margin:24px 0;"><a href="${esc(url)}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:12px;">${esc(text)}</a></div>`;
}

function paraHtml(text) {
  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#d1d5db;">${esc(text)}</p>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ─── Renderers (per-channel bodies) ─────────────────────────────────────────

/**
 * Render the monthly report into per-channel bodies.
 * @returns {{title:string, center:string, bellBody:string, telegram:string, emailSubject:string, emailHtml:string}}
 */
export function renderMonthlyReportBodies(stats, locale, ctx) {
  const c = copyFor(locale);
  const mon = monthLabel(stats.year, stats.month, locale);
  const title = c.reportTitle(mon);
  const L = c.labels;

  const lines = [
    [L.booked, stats.booked],
    [L.completed, stats.completed],
    [L.cancelled, stats.cancelled],
    [L.newClients, stats.newClients],
    [L.messages, stats.messages],
    [L.masters, stats.activeMasters],
  ];
  if (stats.topService) lines.push([L.topService, `${stats.topService.name} (${stats.topService.count})`]);
  if (stats.estimatedRevenue != null) lines.push([L.revenue, stats.estimatedRevenue]);

  const center = `${title}\n${c.intro}\n\n` + lines.map(([k, v]) => `• ${k}: ${v}`).join('\n');
  const telegram = `📊 ${title}\n\n` + lines.map(([k, v]) => `• ${k}: ${v}`).join('\n');
  const bellBody = lines.slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(' · ');

  const url = `${appBase(ctx)}/analytics`;
  const emailHtml = emailLayout(
    title,
    paraHtml(c.intro) + statsTableHtml(lines) + ctaHtml(url, c.reportCta),
    c.footer,
  );

  return { title, center, bellBody, telegram, emailSubject: title, emailHtml };
}

/**
 * Render a subscription-renewal reminder into per-channel bodies.
 * @param {{renewalDateLabel:string, cancelAtPeriodEnd?:boolean}} info
 */
export function renderSubscriptionReminderBodies(info, locale, ctx) {
  const c = copyFor(locale).reminder;
  const isCancel = !!info.cancelAtPeriodEnd;
  const title = isCancel ? c.titleCancel : c.title;
  const intro = isCancel ? c.introCancel(info.renewalDateLabel) : c.intro(info.renewalDateLabel);

  const center = `${title}\n\n${intro}\n${c.hint}`;
  const telegram = `🔔 ${title}\n\n${intro}\n${c.hint}`;
  const bellBody = intro;

  const url = `${appBase(ctx)}/dashboard/billing`;
  const emailHtml = emailLayout(title, paraHtml(intro) + paraHtml(c.hint) + ctaHtml(url, c.cta), copyFor(locale).footer);

  return { title, center, bellBody, telegram, emailSubject: title, emailHtml };
}

/**
 * Render an operator-authored announcement into per-channel bodies. Content
 * comes from the campaign (bodies_json per-channel overrides, else the shared
 * `body`); the email falls back to the standard layout when no HTML is given.
 */
export function renderAnnouncementBodies(campaign, locale, ctx) {
  let bj = {};
  try { bj = campaign.bodies_json ? JSON.parse(campaign.bodies_json) : {}; } catch { bj = {}; }
  if (!bj || typeof bj !== 'object') bj = {};

  const fallback = campaign.body || '';
  const title = campaign.title || 'ManicBot';
  const center = bj.center || fallback;
  const bellBody = bj.bell || (center.length > 200 ? center.slice(0, 200) : center);
  const telegram = bj.telegram || center;

  let emailSubject = title;
  let emailHtml;
  const e = bj.email;
  if (e && typeof e === 'object') {
    emailSubject = e.subject || title;
    emailHtml = e.html || emailLayout(title, paraHtml(center), copyFor(locale).footer);
  } else if (typeof e === 'string' && e.trim()) {
    emailHtml = e;
  } else {
    emailHtml = emailLayout(title, paraHtml(center), copyFor(locale).footer);
  }
  return { title, center, bellBody, telegram, emailSubject, emailHtml };
}

/** Localized long date for a renewal anchor epoch (sec). */
export function formatRenewalDate(epochSec, locale) {
  const tag = LOCALE_TAG[locale] || 'ru';
  return new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(epochSec * 1000));
}
