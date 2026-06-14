import { CB } from '../config.js';
import { t, p2, fmtEmoji } from '../utils/helpers.js';
import { todayStr, warsawNow } from '../utils/date.js';
import { canUse } from '../billing/features.js';

export function mainKb(lg, role = 'client', ctx = null) {
  // Preview mode (landing iPhone mockup): render a tight 3-button menu that
  // matches the marketing design — Записаться / Каталог работ / Прайс-лист.
  // "Мои записи" (CB.MY) is intentionally omitted: a fresh landing visitor has
  // no booking history, so it would be dead weight. No language / contacts /
  // support rows either, so the iPhone screen doesn't overflow with unrelated
  // affordances.
  if (ctx?.previewMode && role === 'client') {
    return { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'm_book'), callback_data: CB.BOOK }],
      [{ text: t(lg, 'm_cat'),  callback_data: CB.CATALOG },
       { text: t(lg, 'm_prices'), callback_data: CB.PRICES }],
    ] } };
  }

  // Public web chat is an anonymous, bot-only client surface. Trim affordances
  // that only make sense for an identified user / staff: "Moje wizyty" (CB.MY —
  // a fresh web session has no booking history) and "Wsparcie" (CB.SUPPORT —
  // clients reach the salon through its own channels). Web-gated on
  // ctx.channel.type === 'web' so Telegram / WhatsApp / Instagram are unchanged.
  const isWeb = ctx?.channel?.type === 'web';

  // Support button: always shown for clients; salon staff (master/admin) gated
  // by plan. Never shown on the public web menu.
  const isSalonStaffKb = role === 'master' || role === 'tenant_owner';
  const showSupport = !isWeb && (!ctx || !isSalonStaffKb || canUse(ctx, 'support_tickets'));
  const lastRow = [
    { text: t(lg, 'm_cont'), callback_data: CB.CONTACTS },
    { text: t(lg, 'm_lang'), callback_data: CB.LANG },
  ];
  if (showSupport) lastRow.push({ text: t(lg, 'm_support'), callback_data: CB.SUPPORT });

  const rows = [
    [{ text: t(lg, 'm_book'), callback_data: CB.BOOK }],
    [{ text: t(lg, 'm_cat'), callback_data: CB.CATALOG },
     { text: t(lg, 'm_prices'), callback_data: CB.PRICES }],
  ];
  // "Moje wizyty" — hidden on the public web menu only.
  if (!isWeb) rows.push([{ text: t(lg, 'm_my'), callback_data: CB.MY }]);
  rows.push([{ text: t(lg, 'm_rev'), callback_data: CB.REVIEWS },
     { text: t(lg, 'm_about'), callback_data: CB.ABOUT }]);
  // Instagram deep-link — web only, and only when the salon has a real
  // per-tenant Instagram URL (resolved by the caller onto ctx.salonInstagramUrl
  // from the raw tenant config, NOT the generic loadInstagramUrl fallback).
  if (isWeb && ctx?.salonInstagramUrl) {
    rows.push([{ text: t(lg, 'm_instagram'), url: ctx.salonInstagramUrl }]);
  }
  rows.push(lastRow);
  if (role === 'system_admin') {
    rows.push([{ text: t(lg, 'adm_management'), callback_data: CB.ADM_MAIN }]);
    rows.push([{ text: t(lg, 'sysadm_title'), callback_data: CB.SYSADM_MAIN }]);
  }
  if (role === 'master' || role === 'tenant_owner') {
    rows.push([{ text: t(lg, 'mst_panel'), callback_data: CB.MST_MAIN }]);
  }
  if (role === 'tenant_owner') {
    rows.push([{ text: t(lg, 'adm_management'), callback_data: CB.ADM_MAIN }]);
  }
  return { reply_markup: { inline_keyboard: rows } };
}

export function langKb() {
  return { reply_markup: { inline_keyboard: [
    [{ text: '🇷🇺 Русский', callback_data: CB.LANG_SET + 'ru' },
     { text: '🇺🇦 Українська', callback_data: CB.LANG_SET + 'ua' }],
    [{ text: '🇬🇧 English', callback_data: CB.LANG_SET + 'en' },
     { text: '🇵🇱 Polski', callback_data: CB.LANG_SET + 'pl' }],
  ] } };
}

const IG_SVC_PAGE_SIZE = 10; // max services per page on Instagram (leaves room for nav + back)

/**
 * Build the rows for one service. Single-row each so the price suffix is
 * readable on narrow Telegram clients.
 */
function svcRows(services, lg) {
  return services.map(s => [{
    text: `${fmtEmoji(s.e)}${t(lg, 'svc_' + s.id)} — ${s.price} ${t(lg, 'cur')}`,
    callback_data: CB.SERVICE + s.id,
  }]);
}

/**
 * Group active services by category in the order defined by
 * ctx.svcCategories (admin sort_order). Services without a category — or
 * with a category that isn't in the catalog (defensive: e.g. recently
 * deleted) — land in a trailing "Без категории" bucket. Returns
 * [{ name: string|null, services: [...] }, ...] with empty buckets dropped.
 */
function groupSvcByCategory(services, categories) {
  const byName = new Map();
  for (const cat of categories) byName.set(cat.name, []);
  const orphans = [];
  for (const s of services) {
    if (s.category && byName.has(s.category)) byName.get(s.category).push(s);
    else orphans.push(s);
  }
  const groups = [];
  for (const cat of categories) {
    const list = byName.get(cat.name);
    if (list && list.length > 0) groups.push({ name: cat.name, services: list });
  }
  if (orphans.length > 0) groups.push({ name: null, services: orphans });
  return groups;
}

export function svcKb(ctx, lg, page = 0) {
  const all = ctx.svc.filter(s => s.active !== false && s.hidden !== true);
  const isIG = ctx.channel?.type === 'instagram';
  const categories = ctx.svcCategories || [];

  // Instagram: paginate when >12 services (13th button would be cut off).
  // IG paging stays FLAT — category headers eat into the 10-row budget and
  // would push the nav off-screen. Owner can split a long IG-only menu by
  // re-ordering services so the most-booked land in the first page.
  if (isIG && all.length > 12) {
    const totalPages = Math.ceil(all.length / IG_SVC_PAGE_SIZE);
    const p = Math.max(0, Math.min(page, totalPages - 1));
    const slice = all.slice(p * IG_SVC_PAGE_SIZE, (p + 1) * IG_SVC_PAGE_SIZE);
    const rows = svcRows(slice, lg);
    const nav = [];
    if (p > 0) nav.push({ text: '◀', callback_data: CB.SVC_PAGE + (p - 1) });
    if (p < totalPages - 1) nav.push({ text: '▶', callback_data: CB.SVC_PAGE + (p + 1) });
    if (nav.length) rows.push(nav);
    rows.push([{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]);
    return { reply_markup: { inline_keyboard: rows } };
  }

  // Flat fallback when there are no categories at all, or no service has a
  // category (defensive — covers a tenant who never opened the categories
  // modal). Keeps the legacy keyboard shape — zero visual change for them.
  const hasAnyAssignment = categories.length > 0 && all.some(s => s.category);
  if (!hasAnyAssignment) {
    const rows = svcRows(all, lg);
    rows.push([{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]);
    return { reply_markup: { inline_keyboard: rows } };
  }

  // Grouped: inject a non-clickable separator row per category. Telegram
  // inline keyboards have no header concept, so a CB.NOOP button acts as a
  // visual section divider ("— Маникюр —").
  const rows = [];
  const groups = groupSvcByCategory(all, categories);
  for (const g of groups) {
    if (g.name) {
      rows.push([{ text: `— ${g.name} —`, callback_data: CB.NOOP }]);
    }
    for (const r of svcRows(g.services, lg)) rows.push(r);
  }
  rows.push([{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]);
  return { reply_markup: { inline_keyboard: rows } };
}

export function calKb(lg, mo = 0) {
  mo = Math.max(0, Math.min(2, mo));
  const w = warsawNow();
  const vd = new Date(Date.UTC(w.year, w.month - 1 + mo, 1));
  const vy = vd.getUTCFullYear(), vm = vd.getUTCMonth();
  const dim = new Date(Date.UTC(vy, vm + 1, 0)).getUTCDate();
  const fd = new Date(Date.UTC(vy, vm, 1)).getUTCDay();
  const f = fd === 0 ? 6 : fd - 1;
  const rows = [];

  const nav = [];
  nav.push(mo > 0 ? { text: '◀️', callback_data: CB.CAL_MONTH + (mo - 1) } : { text: ' ', callback_data: CB.NOOP });
  nav.push({ text: `${t(lg, 'mon')[vm]} ${vy}`, callback_data: CB.NOOP });
  nav.push(mo < 2 ? { text: '▶️', callback_data: CB.CAL_MONTH + (mo + 1) } : { text: ' ', callback_data: CB.NOOP });
  rows.push(nav);

  rows.push(t(lg, 'daysH').map(d => ({ text: d, callback_data: CB.NOOP })));

  const td = todayStr();
  let wk = Array.from({ length: f }, () => ({ text: ' ', callback_data: CB.NOOP }));
  for (let day = 1; day <= dim; day++) {
    const ds = `${vy}-${p2(vm + 1)}-${p2(day)}`;
    if (ds < td) wk.push({ text: '·', callback_data: CB.NOOP });
    else wk.push({ text: ds === td ? `[${day}]` : `${day}`, callback_data: CB.DATE + ds });
    if (wk.length === 7) { rows.push(wk); wk = []; }
  }
  if (wk.length) { while (wk.length < 7) wk.push({ text: ' ', callback_data: CB.NOOP }); rows.push(wk); }

  rows.push([{ text: t(lg, 'other_svc'), callback_data: CB.BOOK }]);
  return { reply_markup: { inline_keyboard: rows } };
}

export function timeKb(slots, lg) {
  const rows = [];
  for (let i = 0; i < slots.length; i += 3)
    rows.push(slots.slice(i, i + 3).map(x => ({ text: `🕐 ${x}`, callback_data: CB.TIME + x })));
  rows.push([{ text: t(lg, 'other_date'), callback_data: CB.CAL_BACK }]);
  return { reply_markup: { inline_keyboard: rows } };
}

export function catListKb(ctx, lg) {
  const rows = ctx.svc.filter(s => s.active !== false && s.hidden !== true).map(s => [{
    text: `${fmtEmoji(s.e)}${t(lg, 'svc_' + s.id)}`,
    callback_data: CB.CAT_PHOTO + s.id + ':0',
  }]);
  rows.push([{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]);
  return { reply_markup: { inline_keyboard: rows } };
}

export function catPhotoKb(lg, svcId, idx, total) {
  const nav = [];
  if (idx > 0) nav.push({ text: '◀️', callback_data: CB.CAT_PHOTO + svcId + ':' + (idx - 1) });
  nav.push({ text: `${idx + 1} / ${total}`, callback_data: CB.NOOP });
  if (idx < total - 1) nav.push({ text: '▶️', callback_data: CB.CAT_PHOTO + svcId + ':' + (idx + 1) });
  return { reply_markup: { inline_keyboard: [
    nav,
    // Book + back share one row so the web widget renders them as an
    // equal-width pair filling the card (a flex .mb-btn-row), instead of two
    // single-button rows that coalesce into the gappy date-picker grid.
    [{ text: t(lg, 'cat_book'), callback_data: CB.SERVICE + svcId },
     { text: t(lg, 'cat_back'), callback_data: CB.CATALOG }],
  ] } };
}

export function aboutPhotoKb(lg, idx, total, instagramUrl) {
  const nav = [];
  if (idx > 0) nav.push({ text: '◀️', callback_data: CB.ABOUT_PHOTO + (idx - 1) });
  nav.push({ text: `${idx + 1} / ${total}`, callback_data: CB.NOOP });
  if (idx < total - 1) nav.push({ text: '▶️', callback_data: CB.ABOUT_PHOTO + (idx + 1) });
  const rows = [nav];
  if (instagramUrl) rows.push([{ text: t(lg, 'm_instagram'), url: instagramUrl }]);
  rows.push([{ text: t(lg, 'm_book'), callback_data: CB.BOOK }]);
  rows.push([{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]);
  return { reply_markup: { inline_keyboard: rows } };
}

export function adminKb(lg, ctx = null) {
  const showBilling = !ctx || !!(ctx.tenantId && ctx.db);
  const rows = [
    [{ text: t(lg, 'adm_today'), callback_data: CB.ADM_TODAY },
     { text: t(lg, 'adm_tomorrow'), callback_data: CB.ADM_TOMORROW }],
    [{ text: t(lg, 'adm_all_apts'), callback_data: CB.ADM_ALL_APTS }],
    [{ text: t(lg, 'adm_masters'), callback_data: CB.ADM_MASTERS }],
    [{ text: t(lg, 'adm_clients'), callback_data: CB.ADM_CLIENTS }],
    [{ text: t(lg, 'svc_manage'), callback_data: CB.SVC_LIST },
     { text: t(lg, 'adm_settings'), callback_data: CB.ADM_SETTINGS }],
    [{ text: t(lg, 'm_about'), callback_data: CB.ADM_ABOUT }],
    [{ text: t(lg, 'adm_support_btn'), callback_data: CB.ADM_SUPPORT_LIST },
     { text: t(lg, 'm_tech_support'), callback_data: CB.TECH_SUPPORT_REQ }],
    [{ text: t(lg, 'adm_to_client'), callback_data: CB.CLIENT_VIEW }],
  ];
  if (showBilling) {
    // Insert billing button before the last row (to_client)
    rows.splice(rows.length - 1, 0, [{ text: t(lg, 'billing_menu'), callback_data: CB.ADM_BILLING }]);
  }
  const showMetaChannels = ctx?.tenantId && (canUse(ctx, 'whatsapp') || canUse(ctx, 'instagram'));
  if (showMetaChannels) {
    rows.splice(rows.length - 1, 0, [{ text: t(lg, 'adm_meta_channels_btn'), callback_data: CB.ADM_META_CHANNELS }]);
  }
  return { reply_markup: { inline_keyboard: rows } };
}

export function masterKb(lg, ctx = null) {
  const showCalendar = !ctx || canUse(ctx, 'calendar');
  const rows = [
    [{ text: t(lg, 'mst_today'), callback_data: CB.MST_TODAY },
     { text: t(lg, 'mst_tomorrow'), callback_data: CB.MST_TOMORROW }],
    [{ text: t(lg, 'svc_manage'), callback_data: CB.SVC_LIST }],
  ];
  if (showCalendar) {
    rows.push([{ text: t(lg, 'mst_calendar'), callback_data: CB.MST_CALENDAR }]);
  }
  rows.push([{ text: t(lg, 'm_tech_support'), callback_data: CB.TECH_SUPPORT_REQ }]);
  rows.push([{ text: t(lg, 'mst_to_client'), callback_data: CB.CLIENT_VIEW }]);
  return { reply_markup: { inline_keyboard: rows } };
}


