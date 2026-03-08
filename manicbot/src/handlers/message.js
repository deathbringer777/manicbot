import { CB, STEP, SALON } from '../config.js';
import { escHtml, fill, t, svcName, isValidChatId, detectLang } from '../utils/helpers.js';
import { isValidDate, isValidTime, fmtDate, fmtDT, resolveDateHint, resolveTimeHint, dateStrForOffset } from '../utils/date.js';
import { kvGet, kvPut } from '../utils/kv.js';
import { send } from '../telegram.js';
import { getState, setState, clearState, checkRateLimit } from '../services/state.js';
import { getLang, setLang, getChatHistory, appendChatTurn, clearChatHistory } from '../services/chat.js';
import { getUser, saveUser, getRole, isAdmin, isMaster, isBlocked, canManageApt, getAdminId, setAdminId, getMaster, saveMaster, listMasters, resolveMasterInput, blockUser, unblockUser } from '../services/users.js';
import { saveServices, loadAboutPhotos, saveAboutPhotos, loadAboutDesc, saveAboutDesc, loadInstagramUrl, saveInstagramUrl } from '../services/services.js';
import { cancelApt, getApts } from '../services/appointments.js';
import { getTicket, clearTicket, getTicketMaster, isTicketCloseWord, incHumanRequestCount } from '../services/tickets.js';
import { createTicket } from '../support/tickets.js';
import { getSupportAgents } from '../roles/roles.js';
import { confirmAllPendingApts, notifyStaffAptCancelled } from '../notifications.js';
import { mainKb, svcKb } from '../ui/keyboards.js';
import { showWelcome, showPrices, showContacts, showCatalog, showMyApts, showLangPick, showReviews } from '../ui/screens.js';
import { showAdminPanel, showMasterPanel, showServiceEdit, showServicesList, showServicePhotos, showAboutSettings, showAboutPhotos, showAboutDescEdit, showAboutInstagramEdit, showMastersList, showClientsList, showAdminCancelAllConfirm } from '../ui/admin.js';
import { startBooking, startBookingWithService, showCancelAllConfirm } from '../ui/booking.js';
import { runWorkersAI, parseAIActions, executeAIAction } from '../ai.js';
import { isWantHumanMessage, isMyAppointmentsMessage, getContextAction, parseQuickBookingPhrase, hasHeavyProfanity, isConfirmAllRequestsMessage, isAdminCancelAllMessage } from '../patterns.js';
import { timingSafeEqual } from '../utils/security.js';

async function handleAIChat(ctx, cid, txt, lg, realRole, from) {
  const showConsultBtn = isWantHumanMessage(txt);
  if (ctx.kv && showConsultBtn) await incHumanRequestCount(ctx, cid);
  let extraConsult = showConsultBtn
    ? { reply_markup: { inline_keyboard: [[{ text: t(lg, 'consultant_btn'), callback_data: CB.CONSULT_REQ }]] } }
    : {};
  const consultHint = extraConsult.reply_markup ? '\n\n' + t(lg, 'consultant_btn_hint') : '';
  if (hasHeavyProfanity(txt)) {
    await send(ctx, cid, t(lg, 'consultant_constructive') + consultHint, extraConsult);
    return;
  }
  const history = await getChatHistory(ctx, cid);
  const aiReply = await runWorkersAI(ctx, txt, lg, realRole, history);
  const { text: aiText, actions } = parseAIActions(aiReply);
  const pageActions = ['MY_APTS', 'PRICES', 'CATALOG', 'CONTACTS', 'MAIN', 'BOOK', 'CANCEL_ALL', 'ADM_PANEL', 'ADM_TODAY', 'ADM_TOMORROW', 'ADM_MASTERS', 'ADM_CONFIRM_ALL', 'ADM_CANCEL_ALL', 'MST_PANEL', 'MST_TODAY', 'MST_TOMORROW'];
  let didAction = false;
  for (const { tag, param } of actions) {
    if (pageActions.includes(tag) || (tag === 'BOOK' && param)) {
      const ran = await executeAIAction(ctx, cid, realRole, tag, param, from);
      if (ran) { didAction = true; break; }
    }
    if (tag === 'CONSULT') {
      extraConsult = { reply_markup: { inline_keyboard: [[{ text: t(lg, 'consultant_btn'), callback_data: CB.CONSULT_REQ }]] } };
      if (ctx.kv) await incHumanRequestCount(ctx, cid);
    }
  }
  await appendChatTurn(ctx, cid, txt, aiText || (didAction ? '' : null));
  if (didAction) return;
  const finalHint = extraConsult.reply_markup ? '\n\n' + t(lg, 'consultant_btn_hint') : '';
  const toSend = (aiText ? escHtml(aiText) : t(lg, 'unknown')) + finalHint;
  await send(ctx, cid, toSend, extraConsult);
}

export async function onMsg(ctx, msg) {
  if (!msg?.chat?.id || !msg?.from) return;
  if (msg.chat.type !== 'private') return;

  const cid = msg.chat.id;
  if (!isValidChatId(cid)) return;
  if (!await checkRateLimit(ctx, cid)) {
    const lg = (await getLang(ctx, cid)) || 'ru';
    await send(ctx, cid, t(lg, 'rate_limit'));
    return;
  }

  const rawName = msg.from.first_name || '';
  const name = escHtml(rawName.slice(0, 64)) || '👋';
  const st = await getState(ctx, cid);
  const lg = (await getLang(ctx, cid)) || 'ru';

  if (await isBlocked(ctx, cid)) return send(ctx, cid, t(lg, 'client_blocked'));

  if (msg.contact && st.step === STEP.REG_PHONE) {
    const phone = String(msg.contact.phone_number || '').slice(0, 20);
    return finishPhone(ctx, cid, phone, st);
  }

  const txt = (msg.text || '').trim().slice(0, 200);

  if (st.step === STEP.SUPPORT_MSG && txt && ctx.globalKv) {
    const ticket = await createTicket(ctx.globalKv, ctx, cid, name, ctx.bot?.botId || null, txt);
    await clearState(ctx, cid);
    if (ticket) {
      const agents = await getSupportAgents(ctx.globalKv);
      const notice = `🆘 Новый тикет #${ticket.id}\nТенант: ${ctx.tenant?.name || ctx.tenantId || '—'}\nОт: ${name}\n\n${escHtml(txt).slice(0, 300)}`;
      const claimKb = { reply_markup: { inline_keyboard: [[{ text: t(lg, 'support_claim_btn'), callback_data: 'tk:' + ticket.id }]] } };
      for (const agentId of agents) {
        try { await send(ctx, agentId, notice, claimKb); } catch (_) {}
      }
      const adminId = await getAdminId(ctx);
      if (adminId && !agents.includes(adminId)) try { await send(ctx, adminId, notice, claimKb); } catch (_) {}
      await send(ctx, cid, t(lg, 'support_ticket_created'), mainKb(lg, 'client'));
    } else {
      await send(ctx, cid, t(lg, 'unknown'), mainKb(lg));
    }
    return;
  }

  if (txt.startsWith('/admin ')) {
    const key = txt.slice(7).trim();
    if (!timingSafeEqual(key, ctx.ADMIN_KEY)) return send(ctx, cid, t(lg, 'adm_wrong_key'));
    await setAdminId(ctx, cid);
    if (!await getLang(ctx, cid)) {
      const detected = detectLang(msg.from.language_code);
      if (detected) await setLang(ctx, cid, detected);
    }
    await send(ctx, cid, t(lg, 'adm_registered'));
    return showAdminPanel(ctx, cid, name);
  }

  const realRole = await getRole(ctx, cid);

  if (ctx.kv && txt) {
    if (realRole === 'client') {
      const ticket = await getTicket(ctx, cid);
      if (ticket?.open) {
        if (isTicketCloseWord(txt)) {
          await clearTicket(ctx, cid);
          await send(ctx, cid, t(lg, 'ticket_closed'));
          if (ticket.masterCid) await send(ctx, ticket.masterCid, t(await getLang(ctx, ticket.masterCid) || 'ru', 'ticket_closed_master'));
          return;
        }
        const toSend = fill(t(lg, 'ticket_from_client'), { msg: escHtml(txt) });
        if (ticket.masterCid) {
          await send(ctx, ticket.masterCid, toSend);
        } else {
          const masters = await listMasters(ctx);
          const adminId = await getAdminId(ctx);
          for (const m of masters) if (m.chatId && !m.onVacation) await send(ctx, m.chatId, toSend);
          if (adminId) await send(ctx, adminId, toSend);
          if (ctx.adminChatId) await send(ctx, ctx.adminChatId, toSend);
        }
        return;
      }
    } else if (realRole === 'master' || realRole === 'admin') {
      const clientCid = await getTicketMaster(ctx, cid);
      if (clientCid) {
        if (isTicketCloseWord(txt)) {
          await clearTicket(ctx, clientCid);
          const clg = await getLang(ctx, clientCid) || 'ru';
          await send(ctx, clientCid, t(clg, 'ticket_closed'));
          await send(ctx, cid, t(lg, 'ticket_closed_master'));
          return;
        }
        await send(ctx, clientCid, escHtml(txt));
        return;
      }
    }
  }

  if (txt === '/client' && realRole !== 'client') {
    return showWelcome(ctx, cid, name);
  }
  if (txt === '/master' && (realRole === 'admin' || realRole === 'master')) {
    return showMasterPanel(ctx, cid, name);
  }
  if (txt === '/panel' && realRole !== 'client') {
    if (realRole === 'admin') return showAdminPanel(ctx, cid, name);
    if (realRole === 'master') return showMasterPanel(ctx, cid, name);
  }

  if (txt === '/start') {
    await clearChatHistory(ctx, cid);
    let hasLang = await getLang(ctx, cid);
    if (!hasLang) {
      const detected = detectLang(msg.from.language_code);
      if (detected) {
        await setLang(ctx, cid, detected);
        hasLang = detected;
      }
    }
    if (!hasLang) return showLangPick(ctx, cid);
    if (realRole === 'admin') return showAdminPanel(ctx, cid, name);
    if (realRole === 'master') return showMasterPanel(ctx, cid, name);
    return showWelcome(ctx, cid, name);
  }
  if (txt === '/book')     return startBooking(ctx, cid, msg.from);
  if (txt === '/my')       return showMyApts(ctx, cid);
  if (txt === '/prices')   return showPrices(ctx, cid);
  if (txt === '/catalog')  return showCatalog(ctx, cid);
  if (txt === '/contacts' || txt === '/instagram') return showContacts(ctx, cid);
  if (txt === '/lang')     return showLangPick(ctx, cid);
  if (txt === '/help')     return send(ctx, cid, fill(t(lg, 'help'), {}), { reply_markup: { remove_keyboard: true } });

  if (txt) {
    if (isMyAppointmentsMessage(txt)) return showMyApts(ctx, cid);
    const ctxAction = getContextAction(txt);
    if (ctxAction === 'prices') return showPrices(ctx, cid);
    if (ctxAction === 'catalog') return showCatalog(ctx, cid);
    if (ctxAction === 'contacts') return showContacts(ctx, cid);
  }

  if (st.step === STEP.CLIENT_CANCEL_COMMENT) {
    const comment = txt ? txt.slice(0, 500) : '';
    const apt = await cancelApt(ctx, st.aptId, cid);
    await clearState(ctx, cid);
    if (apt) {
      await send(ctx, cid, fill(t(lg, 'cancel_ok'), {
        svc: svcName(ctx, lg, apt.svcId), dt: fmtDT(lg, apt.date, apt.time),
      }), { reply_markup: { inline_keyboard: [
        [{ text: t(lg, 'rebook'), callback_data: CB.BOOK }],
        [{ text: t(lg, 'm_my'), callback_data: CB.MY }],
        [{ text: t(lg, 'back_m'), callback_data: CB.MAIN }],
      ] } });
      await notifyStaffAptCancelled(ctx, apt, comment);
    } else {
      await send(ctx, cid, t(lg, 'cancel_err'), mainKb(lg));
    }
    return;
  }

  if (st.step === STEP.ADD_MASTER) {
    const { masterId, masterName, masterUsername, masterPhone } = await resolveMasterInput(ctx, msg, txt);
    if (!masterId) return send(ctx, cid, t(lg, 'adm_master_invalid'));
    const existing = await getMaster(ctx, masterId);
    if (existing) return send(ctx, cid, t(lg, 'adm_master_exists'));
    await saveMaster(ctx, masterId, {
      chatId: masterId,
      name: masterName,
      tgUsername: masterUsername || null,
      phone: masterPhone || null,
      addedAt: Date.now(),
      active: true,
    });
    await clearState(ctx, cid);
    await send(ctx, cid, fill(t(lg, 'adm_master_added'), { n: escHtml(masterName), id: String(masterId) }));
    return showMastersList(ctx, cid);
  }

  if (st.step === STEP.REJECT_COMMENT) {
    if (!txt) return send(ctx, cid, t(lg, 'mst_reject_prompt'));
    const apt = await kvGet(ctx, `ap:${st.aptId}`);
    if (!apt || apt.status !== 'pending') return send(ctx, cid, t(lg, 'mst_already_done'));
    apt.status = 'rejected';
    apt.rejectComment = txt.slice(0, 500);
    await kvPut(ctx, `ap:${st.aptId}`, apt);
    await clearState(ctx, cid);
    const clg = await getLang(ctx, apt.chatId) || 'ru';
    let clientMsg = fill(t(clg, 'apt_rejected'), { svc: svcName(ctx, clg, apt.svcId), dt: fmtDT(clg, apt.date, apt.time) });
    clientMsg += fill(t(clg, 'apt_reject_cmt'), { comment: escHtml(txt) });
    clientMsg += t(clg, 'apt_rebook');
    await send(ctx, apt.chatId, clientMsg, { reply_markup: { inline_keyboard: [
      [{ text: t(clg, 'rebook'), callback_data: CB.BOOK }],
      [{ text: t(clg, 'back_m'), callback_data: CB.MAIN }],
    ]}});
    return send(ctx, cid, fill(t(lg, 'mst_apt_rejected'), { client: escHtml(apt.userName), dt: fmtDT(lg, apt.date, apt.time) }));
  }

  if (st.step === STEP.COUNTER_TIME) {
    if (!txt || !isValidTime(txt)) return send(ctx, cid, t(lg, 'mst_counter_time'));
    st.step = STEP.COUNTER_COMMENT;
    st.newTime = txt;
    await setState(ctx, cid, st);
    return send(ctx, cid, t(lg, 'mst_counter_cmt_prompt'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'mst_skip'), callback_data: CB.APT_COUNTER_SKIP + st.aptId }],
    ]}});
  }

  if (st.step === STEP.COUNTER_COMMENT) {
    const comment = txt ? txt.slice(0, 500) : '';
    const apt = await kvGet(ctx, `ap:${st.aptId}`);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    apt.status = 'counter_offer';
    apt.counterTime = st.newTime;
    apt.counterComment = comment || null;
    apt.confirmedBy = cid;
    await kvPut(ctx, `ap:${st.aptId}`, apt);
    await clearState(ctx, cid);
    const clg = await getLang(ctx, apt.chatId) || 'ru';
    let clientMsg = fill(t(clg, 'apt_counter'), { svc: svcName(ctx, clg, apt.svcId), d: fmtDate(clg, apt.date), newtime: st.newTime });
    if (comment) clientMsg += fill(t(clg, 'apt_counter_cmt'), { comment: escHtml(comment) });
    await send(ctx, apt.chatId, clientMsg, { reply_markup: { inline_keyboard: [
      [{ text: t(clg, 'apt_accept'), callback_data: CB.APT_ACCEPT + apt.id }],
      [{ text: t(clg, 'apt_decline'), callback_data: CB.APT_DECLINE + apt.id }],
      [{ text: t(clg, 'apt_reply_btn'), callback_data: CB.APT_REPLY + apt.id }],
    ]}});
    return send(ctx, cid, t(lg, 'mst_counter_sent'));
  }

  if (st.step === STEP.ADMIN_CANCEL_REASON) {
    const reason = txt ? txt.slice(0, 500) : '';
    const apt = await kvGet(ctx, `ap:${st.aptId}`);
    if (!apt || apt.cx) { await clearState(ctx, cid); return; }
    apt.cancelReason = reason || null;
    const cancelled = await cancelApt(ctx, apt.id, cid, true);
    await clearState(ctx, cid);
    if (cancelled) {
      const clg = await getLang(ctx, cancelled.chatId) || 'ru';
      await send(ctx, cancelled.chatId, fill(t(clg, 'client_cancelled_admin'), {
        svc: svcName(ctx, clg, cancelled.svcId), dt: fmtDT(clg, cancelled.date, cancelled.time),
        reason: escHtml(reason || '—'),
      }), { reply_markup: { inline_keyboard: [
        [{ text: t(clg, 'rebook'), callback_data: CB.BOOK }],
        [{ text: t(clg, 'back_m'), callback_data: CB.MAIN }],
      ]}});
    }
    return send(ctx, cid, t(lg, 'adm_apt_cancelled'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'adm_prev'), callback_data: CB.ADM_MAIN }],
    ]}});
  }

  if (st.step === STEP.CLIENT_REPLY) {
    if (!txt) return send(ctx, cid, t(lg, 'apt_enter_reply'));
    const apt = await kvGet(ctx, `ap:${st.aptId}`);
    if (!apt) { await clearState(ctx, cid); return; }
    await clearState(ctx, cid);
    const recipients = new Set();
    if (apt.confirmedBy) recipients.add(apt.confirmedBy);
    const adminId = await getAdminId(ctx);
    if (adminId) recipients.add(adminId);
    const masters = await listMasters(ctx);
    for (const m of masters) if (m.chatId && !m.onVacation) recipients.add(m.chatId);
    for (const rcid of recipients) {
      const rlg = await getLang(ctx, rcid) || 'ru';
      await send(ctx, rcid, fill(t(rlg, 'mst_client_msg'), { client: escHtml(apt.userName), msg: escHtml(txt) }), { reply_markup: { inline_keyboard: [
        [{ text: t(rlg, 'mst_confirm_btn'), callback_data: CB.APT_CONFIRM + apt.id }],
        [{ text: t(rlg, 'mst_reject_btn'), callback_data: CB.APT_REJECT + apt.id }],
        [{ text: t(rlg, 'mst_counter_btn'), callback_data: CB.APT_COUNTER + apt.id }],
      ]}});
    }
    return send(ctx, cid, t(lg, 'apt_reply_sent'));
  }

  if (st.step === STEP.EDIT_SVC_NAME) {
    if (!txt || !await canManageApt(ctx, cid)) return;
    const s = ctx.svc.find(x => x.id === st.svcId);
    if (s) {
      const cleanName = txt.replace(/<[^>]*>/g, '').trim().slice(0, 100);
      if (!cleanName) return send(ctx, cid, t(lg, 'svc_invalid'));
      if (!s.names) s.names = {};
      for (const lang of ['ru', 'ua', 'en', 'pl']) s.names[lang] = cleanName;
      await saveServices(ctx, ctx.svc);
    }
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_updated'));
    return showServiceEdit(ctx, cid, st.svcId);
  }

  if (st.step === STEP.EDIT_SVC_PRICE) {
    if (!txt || !await canManageApt(ctx, cid)) return;
    const price = parseFloat(txt);
    if (isNaN(price) || price < 0 || price > 99999) return send(ctx, cid, t(lg, 'svc_invalid'));
    const s = ctx.svc.find(x => x.id === st.svcId);
    if (s) { s.price = Math.round(price * 100) / 100; await saveServices(ctx, ctx.svc); }
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_updated'));
    return showServiceEdit(ctx, cid, st.svcId);
  }

  if (st.step === STEP.EDIT_SVC_DUR) {
    if (!txt || !await canManageApt(ctx, cid)) return;
    const dur = parseInt(txt);
    if (isNaN(dur) || dur < 5 || dur > 600) return send(ctx, cid, t(lg, 'svc_invalid'));
    const s = ctx.svc.find(x => x.id === st.svcId);
    if (s) { s.dur = dur; await saveServices(ctx, ctx.svc); }
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_updated'));
    return showServiceEdit(ctx, cid, st.svcId);
  }

  if (st.step === STEP.EDIT_SVC_DESC) {
    if (!await canManageApt(ctx, cid)) return;
    const s = ctx.svc.find(x => x.id === st.svcId);
    if (s) {
      if (!s.desc) s.desc = {};
      const desc = (txt === '/skip' || !txt) ? null : txt.slice(0, 500);
      for (const lang of ['ru', 'ua', 'en', 'pl']) s.desc[lang] = desc;
      await saveServices(ctx, ctx.svc);
    }
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_updated'));
    return showServiceEdit(ctx, cid, st.svcId);
  }

  if (st.step === STEP.EDIT_SVC_EMOJI) {
    if (!txt || !await canManageApt(ctx, cid)) return;
    const emoji = txt.trim().slice(0, 4);
    if (!emoji) return send(ctx, cid, t(lg, 'svc_invalid'));
    const s = ctx.svc.find(x => x.id === st.svcId);
    if (s) { s.e = emoji; await saveServices(ctx, ctx.svc); }
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_updated'));
    return showServiceEdit(ctx, cid, st.svcId);
  }

  if (st.step === STEP.ADD_SVC_ID) {
    if (!txt || !await canManageApt(ctx, cid)) return;
    const newId = txt.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
    if (!newId || newId.length < 2) return send(ctx, cid, t(lg, 'svc_invalid'));
    if (ctx.svc.find(x => x.id === newId)) return send(ctx, cid, t(lg, 'svc_id_exists'));
    ctx.svc.push({
      id: newId, e: '💅', dur: 60, price: 100, active: true,
      order: ctx.svc.length,
      names: { ru: newId, ua: newId, en: newId, pl: newId },
      desc: { ru: null, ua: null, en: null, pl: null },
      photos: [],
    });
    await saveServices(ctx, ctx.svc);
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_added'));
    return showServiceEdit(ctx, cid, newId);
  }

  if (st.step === STEP.ADD_SVC_PHOTO) {
    if (!await canManageApt(ctx, cid)) return;
    let photoRef = null;
    if (msg.photo && msg.photo.length > 0) {
      photoRef = msg.photo[msg.photo.length - 1].file_id;
    } else if (txt && /^https?:\/\/.+/i.test(txt)) {
      photoRef = txt.trim().slice(0, 500);
    }
    if (!photoRef) return send(ctx, cid, t(lg, 'svc_enter_photo'));
    const s = ctx.svc.find(x => x.id === st.svcId);
    if (s) {
      if (!s.photos) s.photos = [];
      s.photos.push(photoRef);
      await saveServices(ctx, ctx.svc);
    }
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_photo_added'));
    return showServicePhotos(ctx, cid, st.svcId);
  }

  if (st.step === STEP.ADD_ABOUT_PHOTO) {
    if (!await isAdmin(ctx, cid)) return;
    let photoRef = null;
    if (msg.photo && msg.photo.length > 0) {
      photoRef = msg.photo[msg.photo.length - 1].file_id;
    } else if (txt && /^https?:\/\/.+/i.test(txt)) {
      photoRef = txt.trim().slice(0, 500);
    }
    if (!photoRef) return send(ctx, cid, t(lg, 'svc_enter_photo'));
    const photos = await loadAboutPhotos(ctx);
    photos.push(photoRef);
    await saveAboutPhotos(ctx, photos);
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_photo_added'));
    return showAboutPhotos(ctx, cid);
  }

  if (st.step === STEP.EDIT_ABOUT_DESC) {
    if (!await isAdmin(ctx, cid)) return;
    const desc = txt === '/skip' || !txt ? null : txt.slice(0, 2000);
    await saveAboutDesc(ctx, desc);
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_updated'));
    return showAboutSettings(ctx, cid);
  }

  if (st.step === STEP.EDIT_ABOUT_INSTAGRAM) {
    if (!await isAdmin(ctx, cid)) return;
    const url = txt === '/skip' ? '' : txt.trim().slice(0, 500);
    if (url && !/^https?:\/\//i.test(url)) {
      return send(ctx, cid, t(lg, 'adm_enter_instagram'));
    }
    await saveInstagramUrl(ctx, url || null);
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_updated'));
    return showAboutSettings(ctx, cid);
  }

  if (st.step === STEP.REG_NAME) {
    const cleaned = txt.replace(/<[^>]*>/g, '').trim();
    if (cleaned.length < 2 || cleaned.length > 50) return send(ctx, cid, t(lg, 'reg_name_err'));
    st.step = STEP.REG_PHONE;
    st.name = cleaned;
    await setState(ctx, cid, st);
    return send(ctx, cid, fill(t(lg, 'reg_phone'), { n: escHtml(cleaned) }), {
      reply_markup: { keyboard: [[{ text: t(lg, 'reg_phone_btn'), request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
    });
  }

  if (st.step === STEP.REG_CONFIRM) {
    if (txt) {
      if (isMyAppointmentsMessage(txt)) return showMyApts(ctx, cid);
      const ctxAction = getContextAction(txt);
      if (ctxAction === 'prices') return showPrices(ctx, cid);
      if (ctxAction === 'catalog') return showCatalog(ctx, cid);
      if (ctxAction === 'contacts') return showContacts(ctx, cid);
      const quick = parseQuickBookingPhrase(txt);
      if (quick) {
        await startBookingWithService(ctx, cid, msg.from, quick.svcId, quick.dateHint, quick.timeHint);
        return;
      }
    }
    return handleAIChat(ctx, cid, txt, lg, realRole, msg.from);
  }

  if (st.step === STEP.REG_PHONE) return finishPhone(ctx, cid, txt, st);

  if (isMyAppointmentsMessage(txt)) return showMyApts(ctx, cid);

  if (txt) {
    const quick = parseQuickBookingPhrase(txt);
    if (quick) {
      return startBookingWithService(ctx, cid, msg.from, quick.svcId, quick.dateHint, quick.timeHint);
    }
  }

  if ((realRole === 'admin' || realRole === 'master') && isConfirmAllRequestsMessage(txt)) {
    const count = await confirmAllPendingApts(ctx, cid);
    const confirmLg = await getLang(ctx, cid) || 'ru';
    const confirmMsg = count > 0 ? fill(t(confirmLg, 'confirm_all_done'), { n: String(count) }) : t(confirmLg, 'confirm_all_none');
    return send(ctx, cid, confirmMsg, { reply_markup: { inline_keyboard: [[{ text: t(confirmLg, 'adm_back'), callback_data: realRole === 'admin' ? CB.ADM_MAIN : CB.MST_MAIN }]] } });
  }

  if (realRole === 'admin' && isAdminCancelAllMessage(txt)) {
    return showAdminCancelAllConfirm(ctx, cid);
  }

  if (txt && /\b(отмени|отменить|скасуй|скасувати|cancel|anuluj)\b/i.test(txt) && /\b(все|всі|всё|all|wszystk)/i.test(txt)) {
    return showCancelAllConfirm(ctx, cid);
  }

  return handleAIChat(ctx, cid, txt, lg, realRole, msg.from);
}

export async function finishPhone(ctx, cid, phone, st) {
  const lg = (await getLang(ctx, cid)) || 'ru';
  const cl = phone.replace(/[^\d+]/g, '').slice(0, 20);
  if (cl.length < 9) return send(ctx, cid, t(lg, 'reg_phone_err'));
  const safeName = escHtml(st.name || '');
  await saveUser(ctx, cid, {
    chatId: cid,
    name: st.name,
    phone: cl,
    tgUsername: st.tgUser || null,
    tgLang: st.tgLang || null,
    registeredAt: Date.now(),
  });
  await clearState(ctx, cid);
  await send(ctx, cid, fill(t(lg, 'reg_done'), { n: safeName, p: escHtml(cl) }), { reply_markup: { remove_keyboard: true } });
  await send(ctx, cid, t(lg, 'now_choose'), svcKb(ctx, lg));
}
