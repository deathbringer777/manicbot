import { send, sendPhoto, editPhoto, api } from '../telegram.js';
import { escHtml, fill, t, svcName, isCorrectionSvc } from '../utils/helpers.js';
import { fmtDT, fmtDate } from '../utils/date.js';
import { CB, SALON, ADDRESS, PHONE, HOURS_STR } from '../config.js';
import { getLang } from '../services/chat.js';
import { clearState } from '../services/state.js';
import { getRole } from '../services/users.js';
import { getApts } from '../services/appointments.js';
import { loadAboutPhotos, loadAboutDesc, loadInstagramUrl } from '../services/services.js';
import { mainKb, langKb, catListKb, catPhotoKb, aboutPhotoKb } from './keyboards.js';
import { showAdminPanel, showMasterPanel } from './admin.js';

export async function showLangPick(ctx, chatId) {
  await send(ctx, chatId,
    '🌍 Выберите язык / Оберіть мову / Choose language / Wybierz język',
    langKb());
}

export async function showWelcome(ctx, cid, name) {
  const lg = await getLang(ctx, cid) || 'ru';
  await clearState(ctx, cid);
  const role = await getRole(ctx, cid);
  await send(ctx, cid, '\u200b', { reply_markup: { remove_keyboard: true } });
  await send(ctx, cid, fill(t(lg, 'welcome'), { s: SALON, n: escHtml(name) }), mainKb(lg, role));
}

/**
 * Routes to the appropriate home screen based on the user's role.
 * - admin / tenant_owner → Admin panel
 * - master → Master panel
 * - client (and others) → Client welcome
 */
export async function showHomeByRole(ctx, cid, name) {
  const role = await getRole(ctx, cid);
  if (role === 'admin' || role === 'tenant_owner') return showAdminPanel(ctx, cid, name);
  if (role === 'master') return showMasterPanel(ctx, cid, name);
  return showWelcome(ctx, cid, name);
}

export async function showPrices(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  let txt = t(lg, 'prices_t');
  for (const s of ctx.svc.filter(sv => sv.active !== false && sv.hidden !== true))
    txt += `${s.e} <b>${t(lg, 'svc_' + s.id)}</b>\n   💵 ${s.price} ${t(lg, 'cur')} · ⏱ ${s.dur} ${t(lg, 'min')}\n\n`;
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: [
    [{ text: t(lg, 'm_book'), callback_data: CB.BOOK }],
    [{ text: t(lg, 'back_m'), callback_data: CB.MAIN }],
  ] } });
}

export async function showContacts(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const instagramUrl = await loadInstagramUrl(ctx);
  const rows = [];
  if (instagramUrl) rows.push([{ text: t(lg, 'm_instagram'), url: instagramUrl }]);
  rows.push([{ text: t(lg, 'm_book'), callback_data: CB.BOOK }]);
  rows.push([{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]);
  await send(ctx, cid, fill(t(lg, 'cont_t'), { addr: ADDRESS, ph: PHONE, h: HOURS_STR }), { reply_markup: { inline_keyboard: rows } });
}

export async function showReviews(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  await send(ctx, cid, fill(t(lg, 'rev_t'), {}), { reply_markup: { inline_keyboard: [
    [{ text: t(lg, 'm_book'), callback_data: CB.BOOK }],
    [{ text: t(lg, 'back_m'), callback_data: CB.MAIN }],
  ] } });
}

export async function showAbout(ctx, cid, idx = 0, msgId = null) {
  const lg = await getLang(ctx, cid) || 'ru';
  const customDesc = await loadAboutDesc(ctx);
  const desc = customDesc || t(lg, 'about_desc_default');
  const instagramUrl = await loadInstagramUrl(ctx);
  const aboutTxt = fill(t(lg, 'about_t'), { s: SALON, addr: ADDRESS, h: HOURS_STR, desc: escHtml(desc) });
  const photos = await loadAboutPhotos(ctx);

  if (!photos.length) {
    return send(ctx, cid, aboutTxt, { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'm_instagram'), url: instagramUrl }],
      [{ text: t(lg, 'm_book'), callback_data: CB.BOOK }],
      [{ text: t(lg, 'back_m'), callback_data: CB.MAIN }],
    ] } });
  }

  const safeIdx = Math.max(0, Math.min(idx, photos.length - 1));
  const kb = aboutPhotoKb(lg, safeIdx, photos.length, instagramUrl);

  if (msgId) {
    const res = await editPhoto(ctx, cid, msgId, photos[safeIdx], aboutTxt, kb);
    if (res && res.ok) return;
    await api(ctx, 'deleteMessage', { chat_id: cid, message_id: msgId });
  }
  await sendPhoto(ctx, cid, photos[safeIdx], aboutTxt, kb);
}

export async function showCatalog(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  await send(ctx, cid, t(lg, 'cat_title'), catListKb(ctx, lg));
}

export async function showCatPhoto(ctx, cid, svcId, idx, msgId) {
  const lg = await getLang(ctx, cid) || 'ru';
  const photos = ctx.svc.find(x => x.id === svcId)?.photos || [];
  if (!photos.length) {
    return send(ctx, cid, `${svcName(ctx, lg, svcId)}\n\n${t(lg, 'cat_empty')}`, { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'cat_back'), callback_data: CB.CATALOG }],
    ] } });
  }
  const safeIdx = Math.max(0, Math.min(idx, photos.length - 1));
  const s = ctx.svc.find(x => x.id === svcId);
  if (!s) return;
  const baseCap = fill(t(lg, 'cat_cap'), {
    e: s.e, svc: t(lg, 'svc_' + svcId),
    p: String(s.price), c: t(lg, 'cur'), d: String(s.dur), min: t(lg, 'min'),
    i: String(safeIdx + 1), total: String(photos.length),
  });
  const rawDesc = (s.desc?.[lg] || s.desc?.ru || '').trim();
  const cap = rawDesc ? `${baseCap}\n\n📝 ${escHtml(rawDesc)}` : baseCap;
  const kb = catPhotoKb(lg, svcId, safeIdx, photos.length);

  if (msgId) {
    const res = await editPhoto(ctx, cid, msgId, photos[safeIdx], cap, kb);
    if (res) return;
  }
  await sendPhoto(ctx, cid, photos[safeIdx], cap, kb);
}

export async function showMyApts(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const apts = await getApts(ctx, cid);
  if (!apts.length) {
    return send(ctx, cid, `${t(lg, 'my_title')}\n\n${t(lg, 'my_empty')}`, { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'm_book'), callback_data: CB.BOOK }],
      [{ text: t(lg, 'back_m'), callback_data: CB.MAIN }],
    ] } });
  }
  let txt = `${t(lg, 'my_title')}\n\n`;
  const btns = [];
  for (const a of apts) {
    const sv = ctx.svc.find(x => x.id === a.svcId);
    if (!sv) continue;
    const stIcon = a.status === 'pending' ? '⏳' : a.status === 'counter_offer' ? '💬' : '✅';
    const priceLine = isCorrectionSvc(a.svcId) ? t(lg, 'free_label') : `💵 ${sv.price} ${t(lg, 'cur')}`;
    txt += `${stIcon} ${svcName(ctx, lg, a.svcId)}\n📅 ${fmtDT(lg, a.date, a.time)}\n${priceLine}\n\n`;
    btns.push([{
      text: fill(t(lg, 'my_cancel'), { d: fmtDate(lg, a.date), t: a.time }),
      callback_data: CB.CANCEL_APT + a.id,
    }]);
  }
  if (apts.length > 1) {
    btns.push([{ text: t(lg, 'my_cancel_all'), callback_data: CB.CANCEL_ALL }]);
  }
  btns.push([{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]);
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: btns } });
}
