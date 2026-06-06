import { send, sendPhoto, trySendPhoto, editPhoto, api } from '../telegram.js';
import { escHtml, fill, t, svcName, isCorrectionSvc, fmtEmoji } from '../utils/helpers.js';
import { fmtDT, fmtDate } from '../utils/date.js';
import { CB, SALON, ADDRESS, PHONE, HOURS_STR, MAPS_URL } from '../config.js';
import { getLang } from '../services/chat.js';
import { clearState } from '../services/state.js';
import { getRole, isPlatformAdmin, getUser } from '../services/users.js';
import { getApts } from '../services/appointments.js';
import { loadAboutPhotos, loadAboutDesc, loadInstagramUrl, getConfig } from '../services/services.js';
import { mainKb, langKb, catListKb, catPhotoKb, aboutPhotoKb } from './keyboards.js';
import { showAdminPanel, showMasterPanel } from './admin.js';
import { showPlatformAdminPanel } from './sysadmin.js';

export async function showLangPick(ctx, chatId) {
  await send(ctx, chatId,
    '🌍 Выберите язык / Оберіть мову / Choose language / Wybierz język',
    langKb());
}

export async function showWelcome(ctx, cid, name) {
  const lg = await getLang(ctx, cid) || 'ru';
  await clearState(ctx, cid);
  const role = await getRole(ctx, cid);
  const salonName = ctx.tenant?.salon?.name || SALON;
  // Web/anonymous visitors come in without a real Telegram first_name; the
  // upstream call sites fall back to '\ud83d\udc4b' as a placeholder. Use the anon
  // variant of the welcome template so we don't render a stray waving-hand
  // emoji where the name should sit.
  const hasRealName = name && name !== '\ud83d\udc4b' && String(name).trim().length > 0;
  const welcomeKey = hasRealName ? 'welcome' : 'welcome_anon';
  const nameForFill = hasRealName ? escHtml(name) : '';
  // On the public web chat, surface the salon's Instagram in the main menu \u2014
  // but only when a real per-tenant URL is set. loadInstagramUrl() falls back
  // to a generic instagram.com, so read the RAW config value instead and hang
  // it on ctx for mainKb (which is sync). Web-only: never touches Telegram.
  if (ctx?.channel?.type === 'web' && ctx.salonInstagramUrl === undefined) {
    const rawIg = await getConfig(ctx, 'instagram_url').catch(() => null);
    ctx.salonInstagramUrl = rawIg && String(rawIg).trim() ? String(rawIg).trim() : null;
  }
  await send(ctx, cid, '\u200b', { reply_markup: { remove_keyboard: true } });
  await send(ctx, cid, fill(t(lg, welcomeKey), { s: salonName, n: nameForFill }), mainKb(lg, role, ctx));
}

/**
 * Routes to the appropriate home screen based on the user's role.
 * - system_admin in main bot  → Platform admin panel
 * - system_admin in tenant bot → Admin panel (acts as admin)
 * - admin / tenant_owner       → Admin panel
 * - master                     → Master panel
 * - client (and others)        → Client welcome
 */
export async function showHomeByRole(ctx, cid, name) {
  // Platform creator / system_admin in main bot → platform panel (highest priority)
  if (!ctx.tenantId && await isPlatformAdmin(ctx, cid)) {
    return showPlatformAdminPanel(ctx, cid, name);
  }
  const role = await getRole(ctx, cid);
  // system_admin in tenant bot acts as admin
  if (role === 'system_admin') return showAdminPanel(ctx, cid, name);
  if (role === 'tenant_owner') return showAdminPanel(ctx, cid, name);
  if (role === 'master') return showMasterPanel(ctx, cid, name);
  return showWelcome(ctx, cid, name);
}

export async function showPrices(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  let txt = t(lg, 'prices_t');
  for (const s of ctx.svc.filter(sv => sv.active !== false && sv.hidden !== true))
    txt += `${fmtEmoji(s.e)}<b>${t(lg, 'svc_' + s.id)}</b>\n   💵 ${s.price} ${t(lg, 'cur')} · ⏱ ${s.dur} ${t(lg, 'min')}\n\n`;
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
  const tenantSalon = ctx.tenant?.salon || {};
  const addr = tenantSalon.address || ADDRESS;
  const ph = tenantSalon.phone || PHONE;
  const h = tenantSalon.hoursStr || HOURS_STR;
  await send(ctx, cid, fill(t(lg, 'cont_t'), { addr, ph, h }), { reply_markup: { inline_keyboard: rows } });
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
  const tenantSalon = ctx.tenant?.salon || {};
  const aboutTxt = fill(t(lg, 'about_t'), {
    s: tenantSalon.name || SALON,
    addr: tenantSalon.address || ADDRESS,
    h: tenantSalon.hoursStr || HOURS_STR,
    desc: escHtml(desc),
  });
  const photos = await loadAboutPhotos(ctx);

  if (!photos.length) {
    const rows = [];
    if (instagramUrl) rows.push([{ text: t(lg, 'm_instagram'), url: instagramUrl }]);
    rows.push([{ text: t(lg, 'm_book'), callback_data: CB.BOOK }]);
    rows.push([{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]);
    return send(ctx, cid, aboutTxt, { reply_markup: { inline_keyboard: rows } });
  }

  const safeIdx = Math.max(0, Math.min(idx, photos.length - 1));
  const kb = aboutPhotoKb(lg, safeIdx, photos.length, instagramUrl);

  if (msgId) {
    const res = await editPhoto(ctx, cid, msgId, photos[safeIdx], aboutTxt, kb);
    if (res && res.ok) return;
    // deleteMessage is Telegram-only; on WA/IG the photo is re-sent instead (no edit support)
    if (!ctx.channel || ctx.channel.type === 'telegram') {
      await api(ctx, 'deleteMessage', { chat_id: cid, message_id: msgId });
    }
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
  const s = ctx.svc.find(x => x.id === svcId);
  if (!s) return;

  let currentIdx = Math.max(0, Math.min(idx, photos.length - 1));

  for (let attempts = 0; attempts < photos.length; attempts++) {
    const baseCap = fill(t(lg, 'cat_cap'), {
      e: s.e, svc: t(lg, 'svc_' + svcId),
      p: String(s.price), c: t(lg, 'cur'), d: String(s.dur), min: t(lg, 'min'),
      i: String(currentIdx + 1), total: String(photos.length),
    });
    const rawDesc = (s.desc?.[lg] || s.desc?.ru || '').trim();
    const cap = rawDesc ? `${baseCap}\n\n📝 ${escHtml(rawDesc)}` : baseCap;
    const kb = catPhotoKb(lg, svcId, currentIdx, photos.length);
    // On web, ship the full photo array so the widget renders a swipe carousel
    // (desktop-style) instead of one-photo-at-a-time ◀️/▶️ server round-trips.
    const extra = ctx.channel?.type === 'web' ? { ...kb, photos } : kb;

    if (msgId) {
      const res = await editPhoto(ctx, cid, msgId, photos[currentIdx], cap, extra);
      if (res) return;
    }
    const res = await trySendPhoto(ctx, cid, photos[currentIdx], cap, extra);
    if (res) return;

    // Photo broken — advance to next, can't edit anymore
    currentIdx = (currentIdx + 1) % photos.length;
    msgId = null;
  }

  // All photos broken — text fallback
  await send(ctx, cid, `${svcName(ctx, lg, svcId)}\n\n${t(lg, 'cat_empty')}`, { reply_markup: { inline_keyboard: [
    [{ text: t(lg, 'cat_back'), callback_data: CB.CATALOG }],
  ] } });
}

export async function showMyApts(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const apts = await getApts(ctx, cid);
  // 0113: subscribed clients get an in-chat unsubscribe button in their personal
  // hub (keyed by chat_id). Hidden for non-subscribers — and always available to
  // subscribers regardless of the capture feature flag.
  const u = await getUser(ctx, cid).catch(() => null);
  const optoutRows = u?.emailOptIn === 1
    ? [[{ text: t(lg, 'email_optout_btn'), callback_data: CB.EMAIL_OPTOUT }]]
    : [];
  if (!apts.length) {
    return send(ctx, cid, `${t(lg, 'my_title')}\n\n${t(lg, 'my_empty')}`, { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'm_book'), callback_data: CB.BOOK }],
      ...optoutRows,
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
  btns.push([{ text: t(lg, 'm_book'), callback_data: CB.BOOK }]);
  for (const r of optoutRows) btns.push(r);
  btns.push([{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]);
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: btns } });
}
