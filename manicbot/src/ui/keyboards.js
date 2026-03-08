import { CB } from '../config.js';
import { t, p2 } from '../utils/helpers.js';
import { todayStr, warsawNow } from '../utils/date.js';

export function mainKb(lg, role = 'client') {
  const rows = [
    [{ text: t(lg, 'm_book'), callback_data: CB.BOOK }],
    [{ text: t(lg, 'm_cat'), callback_data: CB.CATALOG },
     { text: t(lg, 'm_prices'), callback_data: CB.PRICES }],
    [{ text: t(lg, 'm_my'), callback_data: CB.MY }],
    [{ text: t(lg, 'm_rev'), callback_data: CB.REVIEWS },
     { text: t(lg, 'm_about'), callback_data: CB.ABOUT }],
    [{ text: t(lg, 'm_cont'), callback_data: CB.CONTACTS },
     { text: t(lg, 'm_lang'), callback_data: CB.LANG },
     { text: t(lg, 'm_support'), callback_data: CB.SUPPORT }],
  ];
  if (role === 'master' || role === 'admin') {
    rows.push([{ text: t(lg, 'mst_panel'), callback_data: CB.MST_MAIN }]);
  }
  if (role === 'admin') {
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

export function svcKb(ctx, lg) {
  const rows = ctx.svc.filter(s => s.active !== false && s.hidden !== true).map(s => [{
    text: `${s.e} ${t(lg, 'svc_' + s.id)} — ${s.price} ${t(lg, 'cur')}`,
    callback_data: CB.SERVICE + s.id,
  }]);
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
    text: `${s.e} ${t(lg, 'svc_' + s.id)}`,
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
    [{ text: t(lg, 'cat_book'), callback_data: CB.SERVICE + svcId }],
    [{ text: t(lg, 'cat_back'), callback_data: CB.CATALOG }],
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

export function adminKb(lg) {
  return { reply_markup: { inline_keyboard: [
    [{ text: t(lg, 'adm_today'), callback_data: CB.ADM_TODAY },
     { text: t(lg, 'adm_tomorrow'), callback_data: CB.ADM_TOMORROW }],
    [{ text: t(lg, 'adm_masters'), callback_data: CB.ADM_MASTERS }],
    [{ text: t(lg, 'adm_clients'), callback_data: CB.ADM_CLIENTS }],
    [{ text: t(lg, 'svc_manage'), callback_data: CB.SVC_LIST }],
    [{ text: t(lg, 'm_about'), callback_data: CB.ADM_ABOUT }],
    [{ text: t(lg, 'adm_to_client'), callback_data: CB.MAIN }],
  ] } };
}

export function masterKb(lg) {
  return { reply_markup: { inline_keyboard: [
    [{ text: t(lg, 'mst_today'), callback_data: CB.MST_TODAY },
     { text: t(lg, 'mst_tomorrow'), callback_data: CB.MST_TOMORROW }],
    [{ text: t(lg, 'svc_manage'), callback_data: CB.SVC_LIST }],
    [{ text: t(lg, 'mst_to_client'), callback_data: CB.MAIN }],
  ] } };
}
