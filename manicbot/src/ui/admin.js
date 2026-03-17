import { send, sendPhoto, edit } from '../telegram.js';
import { getTenantSupportAgents } from '../roles/roles.js';
import { escHtml, fill, t, p2, svcName } from '../utils/helpers.js';
import { fmtDT, fmtDate, warsawNow } from '../utils/date.js';
import { CB, STEP } from '../config.js';
import { getLang } from '../services/chat.js';
import { clearState, setState, getState } from '../services/state.js';
import { listMasters, getAdminId, isBlocked } from '../services/users.js';
import { loadDayAppointments, getAdminAllApts, getApts } from '../services/appointments.js';
import { loadAboutPhotos, loadAboutDesc, loadInstagramUrl } from '../services/services.js';
import { kvGet, kvListAll } from '../utils/kv.js';
import { adminKb, masterKb } from './keyboards.js';

export async function showServicesList(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  let txt = t(lg, 'svc_list_title');
  const btns = [];
  for (const s of ctx.svc.filter(x => x.hidden !== true)) {
    const status = s.active !== false ? '✅' : '❌';
    const name = s.names?.[lg] || s.names?.ru || s.id;
    txt += `${status} ${s.e} <b>${escHtml(name)}</b> — ${s.price} ${t(lg, 'cur')} · ${s.dur} ${t(lg, 'min')}\n`;
    btns.push([{ text: `✏️ ${s.e} ${name}`, callback_data: CB.SVC_EDIT + s.id }]);
  }
  btns.push([{ text: t(lg, 'svc_add'), callback_data: CB.SVC_ADD }]);
  btns.push([{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }]);
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: btns } });
}

export async function showServiceEdit(ctx, cid, svcId) {
  const lg = await getLang(ctx, cid) || 'ru';
  const s = ctx.svc.find(x => x.id === svcId);
  if (!s || s.hidden) return showServicesList(ctx, cid);
  const name = s.names?.[lg] || s.names?.ru || s.id;
  const desc = s.desc?.[lg] || s.desc?.ru || '—';
  const photoCount = s.photos?.length || 0;
  const statusText = s.active !== false ? '✅' : '❌';
  const txt = fill(t(lg, 'svc_edit_title'), {
    name: escHtml(name), e: s.e, price: String(s.price),
    cur: t(lg, 'cur'), dur: String(s.dur),
    desc: escHtml(desc), photos: String(photoCount), status: statusText,
  });
  const toggleText = s.active !== false ? t(lg, 'svc_toggle_off') : t(lg, 'svc_toggle_on');
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: [
    [{ text: t(lg, 'svc_edit_name'), callback_data: CB.SVC_NAME + svcId },
     { text: t(lg, 'svc_edit_price'), callback_data: CB.SVC_PRICE + svcId }],
    [{ text: t(lg, 'svc_edit_dur'), callback_data: CB.SVC_DUR + svcId },
     { text: t(lg, 'svc_edit_emoji'), callback_data: CB.SVC_EMOJI + svcId }],
    [{ text: t(lg, 'svc_edit_desc'), callback_data: CB.SVC_DESC + svcId }],
    [{ text: t(lg, 'svc_edit_photos') + ` (${photoCount})`, callback_data: CB.SVC_PHOTOS + svcId }],
    [{ text: toggleText, callback_data: CB.SVC_TOGGLE + svcId },
     { text: t(lg, 'svc_delete'), callback_data: CB.SVC_DEL + svcId }],
    [{ text: t(lg, 'adm_back'), callback_data: CB.SVC_LIST }],
  ] } });
}

export async function showServicePhotos(ctx, cid, svcId) {
  const lg = await getLang(ctx, cid) || 'ru';
  const s = ctx.svc.find(x => x.id === svcId);
  if (!s) return showServicesList(ctx, cid);
  const name = s.names?.[lg] || s.names?.ru || s.id;
  const photos = s.photos || [];
  const txt = fill(t(lg, 'svc_photo_title'), { name: escHtml(name), count: String(photos.length) });
  const btns = [];
  for (let i = 0; i < photos.length; i++) {
    const label = `${t(lg, 'svc_photo_del')} #${i + 1}`;
    btns.push([{ text: label, callback_data: CB.SVC_PHOTO_DEL + svcId + ':' + i }]);
  }
  btns.push([{ text: t(lg, 'svc_photo_add'), callback_data: CB.SVC_PHOTO_ADD + svcId }]);
  btns.push([{ text: t(lg, 'adm_back'), callback_data: CB.SVC_EDIT + svcId }]);
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: btns } });
  for (let i = 0; i < Math.min(photos.length, 5); i++) {
    await sendPhoto(ctx, cid, photos[i], `#${i + 1}`, {});
  }
}

export async function showAboutSettings(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  await send(ctx, cid, `🌸 <b>${t(lg, 'm_about')}</b>\n\n${t(lg, 'adm_about_photos')}, ${t(lg, 'adm_about_desc')}, ${t(lg, 'adm_about_instagram')}`, {
    reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'adm_about_photos'), callback_data: CB.ADM_ABOUT_PHOTOS }],
      [{ text: t(lg, 'adm_about_desc'), callback_data: CB.ADM_ABOUT_DESC }],
      [{ text: t(lg, 'adm_about_instagram'), callback_data: CB.ADM_ABOUT_INSTAGRAM }],
      [{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }],
    ] },
  });
}

export async function showAboutPhotos(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const photos = await loadAboutPhotos(ctx);
  const txt = fill(t(lg, 'svc_photo_title'), { name: t(lg, 'm_about'), count: String(photos.length) });
  const btns = [];
  for (let i = 0; i < photos.length; i++) {
    btns.push([{ text: `${t(lg, 'svc_photo_del')} #${i + 1}`, callback_data: CB.ADM_ABOUT_PHOTO_DEL + i }]);
  }
  btns.push([{ text: t(lg, 'svc_photo_add'), callback_data: CB.ADM_ABOUT_PHOTO_ADD }]);
  btns.push([{ text: t(lg, 'adm_back'), callback_data: CB.ADM_ABOUT }]);
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: btns } });
  for (let i = 0; i < Math.min(photos.length, 5); i++) {
    await sendPhoto(ctx, cid, photos[i], `#${i + 1}`, {});
  }
}

export async function showAboutDescEdit(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const current = await loadAboutDesc(ctx);
  const preview = current ? current.slice(0, 200) + (current.length > 200 ? '...' : '') : t(lg, 'about_desc_default').slice(0, 100) + '...';
  await setState(ctx, cid, { step: 'edit_about_desc' });
  return send(ctx, cid, `${t(lg, 'adm_enter_about_desc')}\n\n<i>${t(lg, 'adm_current')}:</i>\n${escHtml(preview)}`, {
    reply_markup: { inline_keyboard: [[{ text: t(lg, 'adm_back'), callback_data: CB.ADM_ABOUT }]] },
  });
}

export async function showAboutInstagramEdit(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const current = await loadInstagramUrl(ctx);
  await setState(ctx, cid, { step: 'edit_about_instagram' });
  return send(ctx, cid, `${t(lg, 'adm_enter_instagram')}\n\n<i>${t(lg, 'adm_current')}:</i> ${escHtml(current)}`, {
    reply_markup: { inline_keyboard: [[{ text: t(lg, 'adm_back'), callback_data: CB.ADM_ABOUT }]] },
  });
}

export async function showAdminPanel(ctx, cid, name) {
  const lg = await getLang(ctx, cid) || 'ru';
  await clearState(ctx, cid);
  await send(ctx, cid, fill(t(lg, 'adm_welcome'), { n: escHtml(name) }), adminKb(lg));
}

export async function showAdminSettings(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  await clearState(ctx, cid);
  const salon = ctx.tenant?.salon || {};
  const name = escHtml(salon.name || ctx.SALON_NAME || '—');
  const phone = escHtml(salon.phone || ctx.PHONE || '—');
  const addr = escHtml(salon.address || ctx.ADDRESS || '—');
  const wh = salon.workHours || ctx.WORK || {};
  const hours = (wh.from != null && wh.to != null) ? `${wh.from}:00 — ${wh.to}:00` : '—';
  const tenantId = ctx.tenantId ? `\n🆔 ID: <code>${ctx.tenantId}</code>` : '';
  const txt = `${t(lg, 'adm_settings_title')}\n\n` +
    `🏠 <b>${name}</b>\n` +
    `📞 ${phone}\n` +
    `📍 ${addr}\n` +
    `🕐 ${hours}` +
    tenantId;
  const kb = { reply_markup: { inline_keyboard: [
    [{ text: t(lg, 'adm_settings_name_btn'), callback_data: CB.ADM_SETTINGS_NAME },
     { text: t(lg, 'adm_settings_phone_btn'), callback_data: CB.ADM_SETTINGS_PHONE }],
    [{ text: t(lg, 'adm_settings_addr_btn'), callback_data: CB.ADM_SETTINGS_ADDR },
     { text: t(lg, 'adm_settings_hours_btn'), callback_data: CB.ADM_SETTINGS_HOURS }],
    [{ text: t(lg, 'svc_manage'), callback_data: CB.SVC_LIST }],
    [{ text: t(lg, 'm_about'), callback_data: CB.ADM_ABOUT }],
    [{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }],
  ] } };
  await send(ctx, cid, txt, kb);
}

export async function showMasterPanel(ctx, cid, name) {
  const lg = await getLang(ctx, cid) || 'ru';
  await clearState(ctx, cid);
  await send(ctx, cid, fill(t(lg, 'mst_welcome'), { n: escHtml(name) }), masterKb(lg));
}

export async function showAdminApts(ctx, cid, dateStr) {
  const lg = await getLang(ctx, cid) || 'ru';
  const apts = (await loadDayAppointments(ctx, dateStr)).sort((a, b) => a.ts - b.ts);
  if (!apts.length) {
    return send(ctx, cid, `📅 <b>${fmtDate(lg, dateStr)}</b>\n\n${t(lg, 'adm_no_apts')}`, { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }],
    ] } });
  }
  const masters = await listMasters(ctx);
  const masterMap = new Map(masters.map(m => [m.chatId, m]));
  let txt = `📅 <b>${fmtDate(lg, dateStr)}</b>\n\n`;
  const btns = [];
  for (const a of apts) {
    const sv = ctx.svc.find(x => x.id === a.svcId);
    if (!sv) continue;
    const st = a.status === 'pending' ? '⏳' : a.status === 'confirmed' ? '✅' : a.status === 'counter_offer' ? '💬' : '🕐';
    const username = a.userTg ? ` · 🔗 @${escHtml(String(a.userTg).replace(/^@+/, ''))}` : '';
    const masterName = a.masterId ? escHtml(masterMap.get(a.masterId)?.name || String(a.masterId)) : t(lg, 'adm_apt_unassigned');
    txt += `${st} <b>${a.time}</b> — ${sv.e} ${t(lg, 'svc_' + a.svcId)}\n`;
    txt += `👤 ${escHtml(a.userName)} · 📱 ${escHtml(a.userPhone)}${username}\n`;
    txt += `👩‍🎨 ${masterName}\n\n`;
    if (a.status !== 'cancelled' && a.status !== 'rejected') {
      const row = [{ text: `❌ ${a.time} ${escHtml(a.userName)}`, callback_data: CB.ADM_CANCEL_APT + a.id }];
      if (!a.masterId && masters.length) {
        row.push({ text: t(lg, 'adm_assign_btn'), callback_data: CB.ADM_ASSIGN_M + a.id });
      }
      btns.push(row);
    }
  }
  btns.push([{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }]);
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: btns } });
}

export async function showMasterAllApts(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const w = warsawNow();
  const monthKeys = [-1, 0, 1, 2].map(off => {
    const d = new Date(Date.UTC(w.year, w.month - 1 + off, 1));
    return `all:${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
  });
  const buckets = await Promise.all(monthKeys.map(k => kvGet(ctx, k)));
  const allIds = [...new Set(buckets.flatMap(b => b || []))];
  const apts = (await Promise.all(allIds.map(id => kvGet(ctx, `ap:${id}`))))
    .filter(a => a && !a.cx && a.status !== 'rejected' && a.ts > Date.now() - 6 * 3600000
      && (a.masterId === cid || a.confirmedBy === cid))
    .sort((a, b) => a.ts - b.ts);

  if (!apts.length) {
    return send(ctx, cid, t(lg, 'adm_no_apts'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'mst_back'), callback_data: CB.MST_MAIN }],
    ] } });
  }

  let txt = `📅 <b>${t(lg, 'mst_tomorrow')}</b>\n\n`;
  const btns = [];
  let currentDate = null;
  for (const a of apts) {
    if (a.date !== currentDate) {
      currentDate = a.date;
      txt += `📅 <b>${fmtDate(lg, a.date)}</b>\n`;
    }
    const sv = ctx.svc.find(x => x.id === a.svcId);
    if (!sv) continue;
    const st = a.status === 'pending' ? '⏳' : a.status === 'confirmed' ? '✅' : a.status === 'counter_offer' ? '💬' : '🕐';
    const username = a.userTg ? ` · 🔗 @${escHtml(String(a.userTg).replace(/^@+/, ''))}` : '';
    txt += `${st} <b>${a.time}</b> — ${sv.e} ${t(lg, 'svc_' + a.svcId)}\n`;
    txt += `👤 ${escHtml(a.userName)} · 📱 ${escHtml(a.userPhone)}${username}\n\n`;
    if (a.status !== 'cancelled' && a.status !== 'rejected') {
      btns.push([{ text: `❌ ${a.time} ${escHtml(a.userName)}`, callback_data: CB.ADM_CANCEL_APT + a.id }]);
    }
  }
  btns.push([{ text: t(lg, 'mst_back'), callback_data: CB.MST_MAIN }]);
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: btns } });
}

export async function showMastersList(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const masters = await listMasters(ctx);
  if (!masters.length) {
    return send(ctx, cid, t(lg, 'adm_no_masters'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'adm_add_master'), callback_data: CB.ADM_ADD_M }],
      [{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }],
    ] } });
  }
  let txt = `👩‍🎨 <b>${t(lg, 'adm_masters')}</b>\n\n`;
  const btns = [];
  for (const m of masters) {
    const vac = m.onVacation ? ` 🏖 <i>${t(lg, 'adm_vacation_status')}</i>` : '';
    txt += `👤 <b>${escHtml(m.name)}</b> (ID: ${m.chatId})${vac}\n`;
    if (m.tgUsername) txt += `🔗 @${escHtml(m.tgUsername)}\n`;
    if (m.phone) txt += `📱 ${escHtml(m.phone)}\n`;
    txt += '\n';
    const vacBtn = m.onVacation ? t(lg, 'adm_vacation_off_btn') : t(lg, 'adm_vacation_btn');
    btns.push([
      { text: `${t(lg, 'adm_del_master')}: ${m.name}`, callback_data: CB.ADM_DEL_M + m.chatId },
      { text: vacBtn, callback_data: CB.ADM_VACATION + m.chatId },
    ]);
  }
  btns.push([{ text: t(lg, 'adm_add_master'), callback_data: CB.ADM_ADD_M }]);
  btns.push([{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }]);
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: btns } });
}

const CLIENTS_PER_PAGE = 8;

export async function showClientsList(ctx, cid, page = 0, msgId = null) {
  const lg = await getLang(ctx, cid) || 'ru';
  const userKeys = await kvListAll(ctx, { prefix: 'u:' });
  const clients = [];
  for (const k of userKeys) {
    const u = await kvGet(ctx, k.name);
    if (u) clients.push(u);
  }
  clients.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const total = clients.length;
  const totalPages = Math.max(1, Math.ceil(total / CLIENTS_PER_PAGE));
  const p = Math.max(0, Math.min(page, totalPages - 1));
  const slice = clients.slice(p * CLIENTS_PER_PAGE, (p + 1) * CLIENTS_PER_PAGE);
  let txt = `👥 <b>${t(lg, 'adm_clients')}</b> (${total})`;
  if (totalPages > 1) txt += ` · ${p + 1}/${totalPages}`;
  txt += '\n\n';
  const cBtns = [];
  for (const c of slice) {
    const blocked = await isBlocked(ctx, c.chatId);
    txt += `👤 <b>${escHtml(c.name)}</b>${blocked ? ' 🚫' : ''}\n📱 ${escHtml(c.phone)} · ${c.tgUsername ? '@' + escHtml(c.tgUsername) : ''}\n\n`;
    cBtns.push([
      { text: `${t(lg, 'adm_block_btn')} ${c.name}`, callback_data: CB.ADM_BLOCK + c.chatId },
      { text: `${t(lg, 'adm_unblock_btn')} ${c.name}`, callback_data: CB.ADM_UNBLOCK + c.chatId },
    ]);
  }
  if (!clients.length) txt += t(lg, 'adm_no_apts');
  if (totalPages > 1) {
    const nav = [];
    if (p > 0) nav.push({ text: t(lg, 'adm_prev'), callback_data: CB.ADM_CLIENTS_PAGE + (p - 1) });
    if (p < totalPages - 1) nav.push({ text: t(lg, 'adm_next'), callback_data: CB.ADM_CLIENTS_PAGE + (p + 1) });
    if (nav.length) cBtns.push(nav);
  }
  cBtns.push([{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }]);
  const opts = { reply_markup: { inline_keyboard: cBtns } };
  if (msgId) await edit(ctx, cid, msgId, txt, opts);
  else await send(ctx, cid, txt, opts);
}

export async function showAdminCancelAllConfirm(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const apts = await getAdminAllApts(ctx);
  if (!apts.length) {
    return send(ctx, cid, t(lg, 'adm_no_apts'), { reply_markup: { inline_keyboard: [[{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }]] } });
  }
  return send(ctx, cid, fill(t(lg, 'adm_cancel_all_confirm'), { n: String(apts.length) }), {
    reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'adm_cancel_all_yes'), callback_data: CB.ADM_CANCEL_ALL_YES }],
      [{ text: t(lg, 'cancel_no'), callback_data: CB.ADM_MAIN }],
    ] },
  });
}

export async function showTenantSupportList(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  if (!ctx.kv) return send(ctx, cid, t(lg, 'sysadm_kv_error'));
  let agents = [];
  try { agents = await getTenantSupportAgents(ctx); } catch {}
  const text = agents.length
    ? `👥 <b>${t(lg, 'adm_support_agents')}</b> (${agents.length}/50)\n\n` +
      agents.map(id => `• <code>${id}</code>`).join('\n')
    : `👥 <b>${t(lg, 'adm_support_agents')}</b>\n\n${t(lg, 'adm_support_no_agents')}`;
  const rows = [];
  rows.push([{ text: t(lg, 'adm_support_add_btn'), callback_data: CB.ADM_SUPPORT_ADD }]);
  for (const agentId of agents) {
    rows.push([{ text: `${t(lg, 'adm_support_remove_btn')} ${agentId}`, callback_data: CB.ADM_SUPPORT_REMOVE + agentId }]);
  }
  rows.push([{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }]);
  await send(ctx, cid, text, { reply_markup: { inline_keyboard: rows } });
}
