import { CB, STEP, VALID_LANGS, LOCK_TTL_SEC, MAX_APTS } from '../config.js';
import { escHtml, fill, t, svcName, isCorrectionSvc, isValidChatId, p2 } from '../utils/helpers.js';
import { isValidDate, isValidTime, fmtDate, fmtDT, warsawToUTC, warsawNow, dateStrForOffset, todayStr } from '../utils/date.js';
import { kvGet, kvPut } from '../utils/kv.js';
import { send, edit, answerCb, sendPhoto, api } from '../telegram.js';
import { getState, setState, clearState, checkRateLimit } from '../services/state.js';
import { getLang, setLang } from '../services/chat.js';
import { getUser, isAdmin, isMaster, isBlocked, canManageApt, getAdminId, getMaster, saveMaster, deleteMaster, blockUser, unblockUser, listMasters } from '../services/users.js';
import { saveServices, loadAboutPhotos, saveAboutPhotos } from '../services/services.js';
import { cancelApt, getApts, getSlots, getAdminAllApts, loadDayAppointments, saveApt } from '../services/appointments.js';
import { getTicket, setTicket, setTicketMaster, clearTicket, resetHumanRequestCount, buildTicketInternalNote } from '../services/tickets.js';
import { claimTicket } from '../support/tickets.js';
import { getRole } from '../services/users.js';
import { notifyAptStaff, sendAptConfirmedToClient, notifyStaffAptCancelled, notifyStaffConsultantRequest, confirmAllPendingApts } from '../notifications.js';
import { mainKb, langKb, svcKb, calKb, timeKb } from '../ui/keyboards.js';
import { showWelcome, showPrices, showContacts, showCatalog, showCatPhoto, showAbout, showMyApts, showLangPick, showReviews } from '../ui/screens.js';
import { showAdminPanel, showMasterPanel, showAdminApts, showMasterAllApts, showMastersList, showClientsList, showServicesList, showServiceEdit, showServicePhotos, showAboutSettings, showAboutPhotos, showAboutDescEdit, showAboutInstagramEdit, showAdminCancelAllConfirm } from '../ui/admin.js';
import { startBooking, startBookingWithService, showCancelAllConfirm } from '../ui/booking.js';
import { makeICS } from '../utils/ics.js';

export async function onCb(ctx, cb) {
  if (!cb?.message?.chat?.id || !cb?.from || !cb?.data) return;
  if (cb.message.chat.type !== 'private') return;

  const cid = cb.message.chat.id;
  if (!isValidChatId(cid)) return;
  await answerCb(ctx, cb.id);

  const d = cb.data;
  if (d === CB.NOOP) return;

  if (!await checkRateLimit(ctx, cid)) return;

  const mid = cb.message.message_id;
  const rawName = cb.from.first_name || '';
  const name = escHtml(rawName.slice(0, 64)) || '👋';

  if (d.startsWith(CB.LANG_SET)) {
    const lang = d.slice(CB.LANG_SET.length);
    if (!VALID_LANGS.has(lang)) return;
    await setLang(ctx, cid, lang);
    await send(ctx, cid, t(lang, 'lang_set'));
    return showWelcome(ctx, cid, name);
  }

  const lg = (await getLang(ctx, cid)) || 'ru';

  if (await isBlocked(ctx, cid)) return send(ctx, cid, t(lg, 'client_blocked'));

  if (d === CB.MAIN)     return showWelcome(ctx, cid, name);
  if (d === CB.LANG)     return showLangPick(ctx, cid);
  if (d === CB.BOOK)     return startBooking(ctx, cid, cb.from);

  if (d === CB.SUPPORT) {
    await setState(ctx, cid, { step: STEP.SUPPORT_MSG });
    return send(ctx, cid, t(lg, 'support_enter_msg'), { reply_markup: { inline_keyboard: [[{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]] } });
  }

  if (d === CB.CONSULT_REQ) {
    if (ctx.kv) {
      const internalNote = await buildTicketInternalNote(ctx, cid);
      await setTicket(ctx, cid, { open: true, masterCid: null, since: Date.now(), internalNote: internalNote || null });
      await notifyStaffConsultantRequest(ctx, cid, {
        reply_markup: { inline_keyboard: [
          [{ text: t(lg, 'ticket_take_btn'), callback_data: CB.TICKET_TAKE + cid },
           { text: t(lg, 'ticket_decline_btn'), callback_data: CB.TICKET_DECLINE + cid }],
        ] },
      }, internalNote);
      await resetHumanRequestCount(ctx, cid);
    }
    await send(ctx, cid, t(lg, 'ticket_desc'));
    await send(ctx, cid, t(lg, 'consultant_sent'));
    return;
  }

  if (d.startsWith(CB.TICKET_DECLINE)) {
    const clientCid = parseInt(d.slice(CB.TICKET_DECLINE.length), 10);
    if (!clientCid) return;
    if (!(await isAdmin(ctx, cid)) && !(await isMaster(ctx, cid))) return;
    const ticket = await getTicket(ctx, clientCid);
    if (!ticket?.open) return;
    await clearTicket(ctx, clientCid);
    const clg = await getLang(ctx, clientCid) || 'ru';
    await send(ctx, clientCid, t(clg, 'ticket_declined'));
    return;
  }

  if (d.startsWith(CB.TICKET_TAKE)) {
    const suffix = d.slice(CB.TICKET_TAKE.length);
    if (suffix.startsWith('tk_') && ctx.globalKv) {
      const role = await getRole(ctx, cid);
      if (role !== 'support' && role !== 'admin') return;
      const result = await claimTicket(ctx.globalKv, suffix, cid);
      if (result.ok) {
        await send(ctx, cid, t(lg, 'ticket_master_hint') + '\n\n🆘 Тикет #' + result.ticket.id + '\nКлиент: ' + (result.ticket.clientName || '—') + '\n\nОтветьте клиенту в чате — сообщения будут пересылаться.');
      } else {
        await send(ctx, cid, result.error === 'Claim race lost' ? t(lg, 'ticket_taken_else') : (result.error || 'Error'));
      }
      return;
    }
    const clientCid = parseInt(suffix, 10);
    if (!clientCid) return;
    if (!(await isAdmin(ctx, cid)) && !(await isMaster(ctx, cid))) return;
    const ticket = await getTicket(ctx, clientCid);
    if (!ticket?.open) return;
    await setTicket(ctx, clientCid, { ...ticket, masterCid: cid });
    await setTicketMaster(ctx, cid, clientCid);
    const masterName = escHtml((cb.from?.first_name || '').trim() || 'Мастер');
    const clg = await getLang(ctx, clientCid) || 'ru';
    await send(ctx, clientCid, fill(t(clg, 'ticket_taken_by'), { name: masterName }));
    let masterMsg = t(lg, 'ticket_master_hint');
    if (ticket.internalNote && ticket.internalNote.trim()) {
      masterMsg += '\n\n' + fill(t(lg, 'ticket_internal_note'), { note: escHtml(ticket.internalNote.trim()) });
    }
    await send(ctx, cid, masterMsg, {
      reply_markup: { inline_keyboard: [
        [{ text: t(lg, 'ticket_close_btn'), callback_data: CB.TICKET_CLOSE + clientCid },
         { text: t(lg, 'ticket_free_correction_btn'), callback_data: CB.TICKET_FREE_CORRECTION + clientCid }],
      ] },
    });
    return;
  }

  if (d.startsWith(CB.TICKET_FREE_CORRECTION)) {
    const clientCid = parseInt(d.slice(CB.TICKET_FREE_CORRECTION.length), 10);
    if (!clientCid) return;
    if (!(await isAdmin(ctx, cid)) && !(await isMaster(ctx, cid))) return;
    const ticket = await getTicket(ctx, clientCid);
    if (!ticket?.open || (ticket.masterCid !== cid && !(await isAdmin(ctx, cid)))) return;
    const clg = await getLang(ctx, clientCid) || 'ru';
    await send(ctx, clientCid, t(clg, 'correction_offer_msg'), {
      reply_markup: { inline_keyboard: [[{ text: t(clg, 'correction_book_btn'), callback_data: CB.SERVICE + 'correction' }]] },
    });
    await send(ctx, cid, t(lg, 'ticket_reply_sent'));
    return;
  }

  if (d.startsWith(CB.TICKET_CLOSE)) {
    const clientCid = parseInt(d.slice(CB.TICKET_CLOSE.length), 10);
    if (!clientCid) return;
    const ticket = await getTicket(ctx, clientCid);
    if (!ticket || (ticket.masterCid !== cid && !(await isAdmin(ctx, cid)))) return;
    await clearTicket(ctx, clientCid);
    const clg = await getLang(ctx, clientCid) || 'ru';
    await send(ctx, clientCid, t(clg, 'ticket_closed'));
    await send(ctx, cid, t(lg, 'ticket_closed_master'));
    return;
  }

  if (d === CB.ADM_MAIN) {
    if (await isAdmin(ctx, cid)) return showAdminPanel(ctx, cid, name);
    if (await isMaster(ctx, cid)) return showMasterPanel(ctx, cid, name);
    return;
  }

  if (d === CB.ADM_TODAY || d === CB.ADM_TOMORROW) {
    if (!await isAdmin(ctx, cid)) return;
    const offset = d === CB.ADM_TOMORROW ? 1 : 0;
    const w = warsawNow();
    const dt = new Date(Date.UTC(w.year, w.month - 1, w.day + offset));
    const ds = `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`;
    return showAdminApts(ctx, cid, ds);
  }

  if (d === CB.ADM_MASTERS) {
    if (!await isAdmin(ctx, cid)) return;
    return showMastersList(ctx, cid);
  }

  if (d === CB.ADM_ADD_M) {
    if (!await isAdmin(ctx, cid)) return;
    await setState(ctx, cid, { step: STEP.ADD_MASTER });
    return send(ctx, cid, t(lg, 'adm_enter_master_id'));
  }

  if (d.startsWith(CB.ADM_DEL_M)) {
    if (!await isAdmin(ctx, cid)) return;
    const mId = parseInt(d.slice(CB.ADM_DEL_M.length));
    if (mId) await deleteMaster(ctx, mId);
    await send(ctx, cid, t(lg, 'adm_master_removed'));
    return showMastersList(ctx, cid);
  }

  if (d.startsWith(CB.ADM_VACATION)) {
    if (!await isAdmin(ctx, cid)) return;
    const mId = parseInt(d.slice(CB.ADM_VACATION.length));
    const m = mId ? await getMaster(ctx, mId) : null;
    if (!m) return showMastersList(ctx, cid);
    m.onVacation = !m.onVacation;
    await saveMaster(ctx, mId, m);
    await send(ctx, cid, m.onVacation ? t(lg, 'adm_vacation_on') : t(lg, 'adm_vacation_off'));
    return showMastersList(ctx, cid);
  }

  if (d === CB.ADM_CLIENTS) {
    if (!await isAdmin(ctx, cid)) return;
    return showClientsList(ctx, cid, 0);
  }

  if (d.startsWith(CB.ADM_CLIENTS_PAGE)) {
    if (!await isAdmin(ctx, cid)) return;
    const page = parseInt(d.slice(CB.ADM_CLIENTS_PAGE.length)) || 0;
    return showClientsList(ctx, cid, page, mid);
  }

  if (d === CB.ADM_ABOUT) {
    if (!await isAdmin(ctx, cid)) return;
    return showAboutSettings(ctx, cid);
  }

  if (d === CB.ADM_ABOUT_PHOTOS) {
    if (!await isAdmin(ctx, cid)) return;
    return showAboutPhotos(ctx, cid);
  }

  if (d === CB.ADM_ABOUT_DESC) {
    if (!await isAdmin(ctx, cid)) return;
    return showAboutDescEdit(ctx, cid);
  }

  if (d === CB.ADM_ABOUT_INSTAGRAM) {
    if (!await isAdmin(ctx, cid)) return;
    return showAboutInstagramEdit(ctx, cid);
  }

  if (d === CB.ADM_ABOUT_PHOTO_ADD) {
    if (!await isAdmin(ctx, cid)) return;
    await setState(ctx, cid, { step: STEP.ADD_ABOUT_PHOTO });
    return send(ctx, cid, t(lg, 'svc_enter_photo'));
  }

  if (d.startsWith(CB.ADM_ABOUT_PHOTO_DEL)) {
    if (!await isAdmin(ctx, cid)) return;
    const idx = parseInt(d.slice(CB.ADM_ABOUT_PHOTO_DEL.length));
    const photos = await loadAboutPhotos(ctx);
    if (idx >= 0 && idx < photos.length) {
      photos.splice(idx, 1);
      await saveAboutPhotos(ctx, photos);
    }
    await send(ctx, cid, t(lg, 'svc_photo_deleted'));
    return showAboutPhotos(ctx, cid);
  }

  if (d.startsWith(CB.ADM_BLOCK)) {
    if (!await isAdmin(ctx, cid)) return;
    const targetId = parseInt(d.slice(CB.ADM_BLOCK.length));
    if (targetId) await blockUser(ctx, targetId);
    await send(ctx, cid, t(lg, 'adm_blocked'));
    return showClientsList(ctx, cid);
  }

  if (d.startsWith(CB.ADM_UNBLOCK)) {
    if (!await isAdmin(ctx, cid)) return;
    const targetId = parseInt(d.slice(CB.ADM_UNBLOCK.length));
    if (targetId) await unblockUser(ctx, targetId);
    await send(ctx, cid, t(lg, 'adm_unblocked'));
    return showClientsList(ctx, cid);
  }

  if (d.startsWith(CB.ADM_CANCEL_APT)) {
    if (!await canManageApt(ctx, cid)) return;
    const aptId = d.slice(CB.ADM_CANCEL_APT.length);
    await setState(ctx, cid, { step: STEP.ADMIN_CANCEL_REASON, aptId });
    return send(ctx, cid, t(lg, 'adm_cancel_prompt'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'adm_cancel_skip'), callback_data: CB.ADM_CANCEL_SKIP + aptId }],
      [{ text: t(lg, 'adm_prev'), callback_data: CB.ADM_MAIN }],
    ]}});
  }

  if (d.startsWith(CB.ADM_CANCEL_SKIP)) {
    if (!await canManageApt(ctx, cid)) return;
    const aptId = d.slice(CB.ADM_CANCEL_SKIP.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || apt.cx) { await clearState(ctx, cid); return; }
    const cancelled = await cancelApt(ctx, apt.id, cid, true);
    await clearState(ctx, cid);
    if (cancelled) {
      const clg = await getLang(ctx, cancelled.chatId) || 'ru';
      await send(ctx, cancelled.chatId, fill(t(clg, 'client_cancelled_admin'), {
        svc: svcName(ctx, clg, cancelled.svcId), dt: fmtDT(clg, cancelled.date, cancelled.time),
        reason: '—',
      }), { reply_markup: { inline_keyboard: [
        [{ text: t(clg, 'rebook'), callback_data: CB.BOOK }],
        [{ text: t(clg, 'back_m'), callback_data: CB.MAIN }],
      ]}});
    }
    return send(ctx, cid, t(lg, 'adm_apt_cancelled'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'adm_prev'), callback_data: CB.ADM_MAIN }],
    ]}});
  }

  if (d === CB.ADM_CANCEL_ALL_YES) {
    if (!await isAdmin(ctx, cid)) return;
    const apts = await getAdminAllApts(ctx);
    let count = 0;
    for (const apt of apts) {
      const cancelled = await cancelApt(ctx, apt.id, cid, true);
      if (cancelled) {
        count++;
        const clg = await getLang(ctx, cancelled.chatId) || 'ru';
        await send(ctx, cancelled.chatId, fill(t(clg, 'client_cancelled_admin'), {
          svc: svcName(ctx, clg, cancelled.svcId), dt: fmtDT(clg, cancelled.date, cancelled.time),
          reason: '—',
        }), { reply_markup: { inline_keyboard: [
          [{ text: t(clg, 'rebook'), callback_data: CB.BOOK }],
          [{ text: t(clg, 'back_m'), callback_data: CB.MAIN }],
        ]}});
      }
    }
    return send(ctx, cid, fill(t(lg, 'adm_cancel_all_done'), { n: String(count) }), { reply_markup: { inline_keyboard: [[{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }]] } });
  }

  if (d.startsWith(CB.APT_CONFIRM)) {
    if (!await canManageApt(ctx, cid)) return;
    const aptId = d.slice(CB.APT_CONFIRM.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    apt.status = 'confirmed';
    apt.confirmedBy = cid;
    await kvPut(ctx, `ap:${aptId}`, apt);
    await sendAptConfirmedToClient(ctx, apt);
    return send(ctx, cid, fill(t(lg, 'mst_apt_confirmed'), { client: escHtml(apt.userName), dt: fmtDT(lg, apt.date, apt.time) }));
  }

  if (d.startsWith(CB.APT_REJECT) && !d.startsWith(CB.APT_REJECT_SKIP)) {
    if (!await canManageApt(ctx, cid)) return;
    const aptId = d.slice(CB.APT_REJECT.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    await setState(ctx, cid, { step: STEP.REJECT_COMMENT, aptId });
    return send(ctx, cid, t(lg, 'mst_reject_prompt'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'mst_skip'), callback_data: CB.APT_REJECT_SKIP + aptId }],
    ]}});
  }

  if (d.startsWith(CB.APT_REJECT_SKIP)) {
    if (!await canManageApt(ctx, cid)) return;
    const aptId = d.slice(CB.APT_REJECT_SKIP.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    apt.status = 'rejected';
    await kvPut(ctx, `ap:${aptId}`, apt);
    await clearState(ctx, cid);
    const clg = await getLang(ctx, apt.chatId) || 'ru';
    let clientMsg = fill(t(clg, 'apt_rejected'), { svc: svcName(ctx, clg, apt.svcId), dt: fmtDT(clg, apt.date, apt.time) });
    clientMsg += t(clg, 'apt_rebook');
    await send(ctx, apt.chatId, clientMsg, { reply_markup: { inline_keyboard: [
      [{ text: t(clg, 'rebook'), callback_data: CB.BOOK }],
      [{ text: t(clg, 'back_m'), callback_data: CB.MAIN }],
    ]}});
    return send(ctx, cid, fill(t(lg, 'mst_apt_rejected'), { client: escHtml(apt.userName), dt: fmtDT(lg, apt.date, apt.time) }));
  }

  if (d.startsWith(CB.APT_COUNTER) && !d.startsWith(CB.APT_COUNTER_SKIP)) {
    if (!await canManageApt(ctx, cid)) return;
    const aptId = d.slice(CB.APT_COUNTER.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    await setState(ctx, cid, { step: STEP.COUNTER_TIME, aptId });
    return send(ctx, cid, t(lg, 'mst_counter_time'));
  }

  if (d.startsWith(CB.APT_COUNTER_SKIP)) {
    if (!await canManageApt(ctx, cid)) return;
    const aptId = d.slice(CB.APT_COUNTER_SKIP.length);
    const st = await getState(ctx, cid);
    if (st.step !== STEP.COUNTER_COMMENT || st.aptId !== aptId) return;
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    apt.status = 'counter_offer';
    apt.counterTime = st.newTime;
    apt.counterComment = null;
    apt.confirmedBy = cid;
    await kvPut(ctx, `ap:${aptId}`, apt);
    await clearState(ctx, cid);
    const clg = await getLang(ctx, apt.chatId) || 'ru';
    await send(ctx, apt.chatId, fill(t(clg, 'apt_counter'), { svc: svcName(ctx, clg, apt.svcId), d: fmtDate(clg, apt.date), newtime: st.newTime }), { reply_markup: { inline_keyboard: [
      [{ text: t(clg, 'apt_accept'), callback_data: CB.APT_ACCEPT + apt.id }],
      [{ text: t(clg, 'apt_decline'), callback_data: CB.APT_DECLINE + apt.id }],
      [{ text: t(clg, 'apt_reply_btn'), callback_data: CB.APT_REPLY + apt.id }],
    ]}});
    return send(ctx, cid, t(lg, 'mst_counter_sent'));
  }

  if (d.startsWith(CB.APT_ACCEPT)) {
    const aptId = d.slice(CB.APT_ACCEPT.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || apt.status !== 'counter_offer' || apt.chatId !== cid) return;
    const newTime = apt.counterTime;
    apt.time = newTime;
    const [y, mo, dd] = apt.date.split('-').map(Number);
    const [h, mi] = newTime.split(':').map(Number);
    apt.ts = warsawToUTC(y, mo, dd, h, mi).getTime();
    apt.status = 'confirmed';
    await kvPut(ctx, `ap:${aptId}`, apt);
    await sendAptConfirmedToClient(ctx, apt);
    if (apt.confirmedBy) {
      const mlg = await getLang(ctx, apt.confirmedBy) || 'ru';
      await send(ctx, apt.confirmedBy, fill(t(mlg, 'mst_client_accepted'), { client: escHtml(apt.userName), newtime: newTime }));
    }
    return;
  }

  if (d.startsWith(CB.APT_DECLINE)) {
    const aptId = d.slice(CB.APT_DECLINE.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || apt.chatId !== cid) return;
    await setState(ctx, cid, { step: STEP.CLIENT_REPLY, aptId });
    await send(ctx, cid, t(lg, 'apt_enter_reply'));
    if (apt.confirmedBy) {
      const mlg = await getLang(ctx, apt.confirmedBy) || 'ru';
      await send(ctx, apt.confirmedBy, fill(t(mlg, 'mst_client_declined'), { client: escHtml(apt.userName) }));
    }
    return;
  }

  if (d.startsWith(CB.APT_REPLY)) {
    const aptId = d.slice(CB.APT_REPLY.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || apt.chatId !== cid) return;
    await setState(ctx, cid, { step: STEP.CLIENT_REPLY, aptId });
    return send(ctx, cid, t(lg, 'apt_enter_reply'));
  }

  if (d === CB.SVC_LIST) {
    if (!await canManageApt(ctx, cid)) return;
    return showServicesList(ctx, cid);
  }

  if (d.startsWith(CB.SVC_EDIT)) {
    if (!await canManageApt(ctx, cid)) return;
    return showServiceEdit(ctx, cid, d.slice(CB.SVC_EDIT.length));
  }

  if (d.startsWith(CB.SVC_NAME)) {
    if (!await canManageApt(ctx, cid)) return;
    await setState(ctx, cid, { step: STEP.EDIT_SVC_NAME, svcId: d.slice(CB.SVC_NAME.length) });
    return send(ctx, cid, t(lg, 'svc_enter_name'));
  }

  if (d.startsWith(CB.SVC_PRICE)) {
    if (!await canManageApt(ctx, cid)) return;
    await setState(ctx, cid, { step: STEP.EDIT_SVC_PRICE, svcId: d.slice(CB.SVC_PRICE.length) });
    return send(ctx, cid, t(lg, 'svc_enter_price'));
  }

  if (d.startsWith(CB.SVC_DUR)) {
    if (!await canManageApt(ctx, cid)) return;
    await setState(ctx, cid, { step: STEP.EDIT_SVC_DUR, svcId: d.slice(CB.SVC_DUR.length) });
    return send(ctx, cid, t(lg, 'svc_enter_dur'));
  }

  if (d.startsWith(CB.SVC_DESC)) {
    if (!await canManageApt(ctx, cid)) return;
    await setState(ctx, cid, { step: STEP.EDIT_SVC_DESC, svcId: d.slice(CB.SVC_DESC.length) });
    return send(ctx, cid, t(lg, 'svc_enter_desc'));
  }

  if (d.startsWith(CB.SVC_EMOJI)) {
    if (!await canManageApt(ctx, cid)) return;
    await setState(ctx, cid, { step: STEP.EDIT_SVC_EMOJI, svcId: d.slice(CB.SVC_EMOJI.length) });
    return send(ctx, cid, t(lg, 'svc_enter_emoji'));
  }

  if (d.startsWith(CB.SVC_TOGGLE)) {
    if (!await canManageApt(ctx, cid)) return;
    const svcId = d.slice(CB.SVC_TOGGLE.length);
    const s = ctx.svc.find(x => x.id === svcId);
    if (s) {
      s.active = !(s.active !== false);
      await saveServices(ctx, ctx.svc);
    }
    return showServiceEdit(ctx, cid, svcId);
  }

  if (d.startsWith(CB.SVC_DEL)) {
    if (!await canManageApt(ctx, cid)) return;
    const svcId = d.slice(CB.SVC_DEL.length);
    ctx.svc = ctx.svc.filter(x => x.id !== svcId);
    await saveServices(ctx, ctx.svc);
    await send(ctx, cid, t(lg, 'svc_deleted'));
    return showServicesList(ctx, cid);
  }

  if (d === CB.SVC_ADD) {
    if (!await canManageApt(ctx, cid)) return;
    await setState(ctx, cid, { step: STEP.ADD_SVC_ID });
    return send(ctx, cid, t(lg, 'svc_enter_id'));
  }

  if (d.startsWith(CB.SVC_PHOTOS)) {
    if (!await canManageApt(ctx, cid)) return;
    return showServicePhotos(ctx, cid, d.slice(CB.SVC_PHOTOS.length));
  }

  if (d.startsWith(CB.SVC_PHOTO_ADD)) {
    if (!await canManageApt(ctx, cid)) return;
    const svcId = d.slice(CB.SVC_PHOTO_ADD.length);
    await setState(ctx, cid, { step: STEP.ADD_SVC_PHOTO, svcId });
    return send(ctx, cid, t(lg, 'svc_enter_photo'));
  }

  if (d.startsWith(CB.SVC_PHOTO_DEL)) {
    if (!await canManageApt(ctx, cid)) return;
    const parts = d.slice(CB.SVC_PHOTO_DEL.length).split(':');
    const svcId = parts[0];
    const idx = parseInt(parts[1]);
    const s = ctx.svc.find(x => x.id === svcId);
    if (s?.photos && idx >= 0 && idx < s.photos.length) {
      s.photos.splice(idx, 1);
      await saveServices(ctx, ctx.svc);
    }
    await send(ctx, cid, t(lg, 'svc_photo_deleted'));
    return showServicePhotos(ctx, cid, svcId);
  }

  if (d === CB.MST_MAIN) return showMasterPanel(ctx, cid, name);

  if (d === CB.MST_TODAY || d === CB.MST_TOMORROW) {
    if (!await isMaster(ctx, cid)) return;
    if (d === CB.MST_TOMORROW) return showMasterAllApts(ctx, cid);
    return showAdminApts(ctx, cid, dateStrForOffset(0));
  }

  if (d === CB.REG_YES) {
    const st = await getState(ctx, cid);
    if (st.step !== STEP.REG_CONFIRM) return;
    st.step = STEP.REG_PHONE;
    st.name = st.tgName;
    await setState(ctx, cid, st);
    return send(ctx, cid, fill(t(lg, 'reg_phone'), { n: escHtml(st.tgName) }), {
      reply_markup: { keyboard: [[{ text: t(lg, 'reg_phone_btn'), request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
    });
  }

  if (d === CB.REG_CHANGE) {
    const st = await getState(ctx, cid);
    if (st.step !== STEP.REG_CONFIRM) return;
    st.step = STEP.REG_NAME;
    await setState(ctx, cid, st);
    return send(ctx, cid, t(lg, 'reg_enter_name'));
  }
  if (d === CB.MY)       return showMyApts(ctx, cid);
  if (d === CB.PRICES)   return showPrices(ctx, cid);
  if (d === CB.CONTACTS) return showContacts(ctx, cid);
  if (d === CB.REVIEWS)  return showReviews(ctx, cid);
  if (d === CB.ABOUT)    return showAbout(ctx, cid);
  if (d === CB.CATALOG)  return showCatalog(ctx, cid);

  if (d.startsWith(CB.CAT_PHOTO)) {
    const parts = d.slice(CB.CAT_PHOTO.length).split(':');
    const svcId = parts[0];
    if (!ctx.svcIds.has(svcId)) return;
    const idx = Math.max(0, parseInt(parts[1]) || 0);
    return showCatPhoto(ctx, cid, svcId, idx, mid);
  }

  if (d.startsWith(CB.ABOUT_PHOTO)) {
    const idx = Math.max(0, parseInt(d.slice(CB.ABOUT_PHOTO.length)) || 0);
    return showAbout(ctx, cid, idx, mid);
  }

  if (d.startsWith(CB.SERVICE)) {
    const sid = d.slice(CB.SERVICE.length);
    if (!ctx.svcIds.has(sid)) return;
    const s = ctx.svc.find(x => x.id === sid);
    const user = await getUser(ctx, cid);
    if (!user) {
      return startBooking(ctx, cid, cb.from);
    }
    await setState(ctx, cid, { step: STEP.DATE, svcId: sid });
    const chosenText = isCorrectionSvc(sid)
      ? fill(t(lg, 'chosen_correction'), { svc: svcName(ctx, lg, sid) }) + '\n\n' + t(lg, 'choose_date')
      : fill(t(lg, 'chosen'), { svc: svcName(ctx, lg, sid), p: String(s.price), c: t(lg, 'cur'), d: String(s.dur), min: t(lg, 'min') }) + '\n\n' + t(lg, 'choose_date');
    await send(ctx, cid, chosenText, calKb(lg, 0));
    return;
  }

  if (d.startsWith(CB.CAL_MONTH)) {
    const off = Math.max(0, Math.min(2, parseInt(d.slice(CB.CAL_MONTH.length)) || 0));
    return edit(ctx, cid, mid, t(lg, 'choose_date'), calKb(lg, off));
  }

  if (d.startsWith(CB.DATE)) {
    const date = d.slice(CB.DATE.length);
    if (!isValidDate(date)) return;
    if (date < todayStr()) return;
    const st = await getState(ctx, cid);
    if (!st.svcId || !ctx.svcIds.has(st.svcId)) return send(ctx, cid, t(lg, 'book_err'), svcKb(ctx, lg));
    const slots = await getSlots(ctx, date, st.svcId);
    if (!slots.length) return send(ctx, cid, fill(t(lg, 'no_slots'), { d: fmtDate(lg, date) }), calKb(lg, 0));
    st.step = STEP.TIME;
    st.date = date;
    await setState(ctx, cid, st);
    await send(ctx, cid, `📅 <b>${fmtDate(lg, date)}</b>\n${svcName(ctx, lg, st.svcId)}\n\n${t(lg, 'choose_time')}`, timeKb(slots, lg));
    return;
  }

  if (d === CB.CAL_BACK) return send(ctx, cid, t(lg, 'choose_date'), calKb(lg, 0));

  if (d.startsWith(CB.TIME)) {
    const time = d.slice(CB.TIME.length);
    if (!isValidTime(time)) return;
    const st = await getState(ctx, cid);
    if (!st.svcId || !st.date || !ctx.svcIds.has(st.svcId) || !isValidDate(st.date)) {
      return send(ctx, cid, t(lg, 'book_err'), svcKb(ctx, lg));
    }
    st.step = STEP.CONFIRM;
    st.time = time;
    await setState(ctx, cid, st);
    const s = ctx.svc.find(x => x.id === st.svcId);
    const user = await getUser(ctx, cid);
    const confLines = isCorrectionSvc(st.svcId)
      ? [fill(t(lg, 'confirm_correction'), { svc: svcName(ctx, lg, st.svcId), dt: fmtDT(lg, st.date, time), name: escHtml(user?.name || '—'), phone: escHtml(user?.phone || '—') })]
      : [t(lg, 'confirm_title'), '', svcName(ctx, lg, st.svcId), `📅 ${fmtDT(lg, st.date, time)}`, `⏱ ${s.dur} ${t(lg, 'min')}`, `💵 ${s.price} ${t(lg, 'cur')}`, '', `👤 ${escHtml(user?.name || '—')}`, `📱 ${escHtml(user?.phone || '—')}`];
    await send(ctx, cid, confLines.join('\n'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'confirm_yes'), callback_data: CB.CONFIRM }],
      [{ text: t(lg, 'confirm_no'), callback_data: CB.CANCEL_BOOK }],
    ] } });
    return;
  }

  if (d === CB.CONFIRM) {
    const st = await getState(ctx, cid);
    if (st.step !== STEP.CONFIRM || !st.svcId || !st.date || !st.time) {
      return send(ctx, cid, t(lg, 'book_err'), mainKb(lg));
    }
    if (!ctx.svcIds.has(st.svcId) || !isValidDate(st.date) || !isValidTime(st.time)) {
      return send(ctx, cid, t(lg, 'book_err'), mainKb(lg));
    }

    const lockKey = `lock:slot:${st.date}:${st.time}`;
    const lockTaken = await kvGet(ctx, lockKey);
    if (lockTaken) {
      const fallbackSlots = await getSlots(ctx, st.date, st.svcId);
      if (fallbackSlots.length) {
        return send(ctx, cid, t(lg, 'slot_taken'), timeKb(fallbackSlots, lg));
      }
      return send(ctx, cid, fill(t(lg, 'no_slots'), { d: fmtDate(lg, st.date) }), calKb(lg, 0));
    }
    await kvPut(ctx, lockKey, 1, { expirationTtl: LOCK_TTL_SEC });

    const slots = await getSlots(ctx, st.date, st.svcId);
    if (!slots.includes(st.time)) {
      if (slots.length) {
        return send(ctx, cid, t(lg, 'slot_taken'), timeKb(slots, lg));
      }
      return send(ctx, cid, fill(t(lg, 'no_slots'), { d: fmtDate(lg, st.date) }), calKb(lg, 0));
    }

    await clearState(ctx, cid);

    const s = ctx.svc.find(x => x.id === st.svcId);
    const user = await getUser(ctx, cid);
    const [y, mo, dd] = st.date.split('-').map(Number);
    const [h, mi] = st.time.split(':').map(Number);
    const ts = warsawToUTC(y, mo, dd, h, mi).getTime();

    const apt = await saveApt(ctx, {
      chatId: cid, svcId: st.svcId, date: st.date, time: st.time, ts,
      userName: user?.name || '?', userPhone: user?.phone || '?',
      userTg: user?.tgUsername ? String(user.tgUsername).replace(/^@+/, '') : null,
    });

    if (!apt) {
      return send(ctx, cid, fill(t(lg, 'book_limit'), { n: String(MAX_APTS) }), mainKb(lg));
    }

    await send(ctx, cid, fill(t(lg, 'apt_pending'), {
      svc: svcName(ctx, lg, st.svcId), dt: fmtDT(lg, st.date, st.time),
    }), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'back_m'), callback_data: CB.MAIN }],
    ] } });

    await notifyAptStaff(ctx, apt, user);
    return;
  }

  if (d === CB.CANCEL_BOOK) {
    await clearState(ctx, cid);
    return send(ctx, cid, t(lg, 'book_cancelled'), mainKb(lg));
  }

  if (d.startsWith(CB.CANCEL_APT_YES)) {
    const aptId = d.slice(CB.CANCEL_APT_YES.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || apt.chatId !== cid || apt.cx) {
      return send(ctx, cid, t(lg, 'cancel_err'), mainKb(lg));
    }
    await setState(ctx, cid, { step: STEP.CLIENT_CANCEL_COMMENT, aptId });
    return send(ctx, cid, t(lg, 'cancel_comment_prompt'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'cancel_comment_skip'), callback_data: CB.CANCEL_APT_SKIP + aptId }],
      [{ text: t(lg, 'cancel_no'), callback_data: CB.MY }],
    ] } });
  }

  if (d.startsWith(CB.CANCEL_APT_SKIP)) {
    const aptId = d.slice(CB.CANCEL_APT_SKIP.length);
    const apt = await cancelApt(ctx, aptId, cid);
    await clearState(ctx, cid);
    if (apt) {
      await send(ctx, cid, fill(t(lg, 'cancel_ok'), {
        svc: svcName(ctx, lg, apt.svcId), dt: fmtDT(lg, apt.date, apt.time),
      }), { reply_markup: { inline_keyboard: [
        [{ text: t(lg, 'rebook'), callback_data: CB.BOOK }],
        [{ text: t(lg, 'm_my'), callback_data: CB.MY }],
        [{ text: t(lg, 'back_m'), callback_data: CB.MAIN }],
      ] } });
      await notifyStaffAptCancelled(ctx, apt);
    } else {
      await send(ctx, cid, t(lg, 'cancel_err'), mainKb(lg));
    }
    return;
  }

  if (d === CB.CANCEL_ALL) {
    return showCancelAllConfirm(ctx, cid);
  }

  if (d === CB.CANCEL_ALL_YES) {
    const apts = await getApts(ctx, cid);
    for (const apt of apts) {
      const cancelled = await cancelApt(ctx, apt.id, cid);
      if (cancelled) await notifyStaffAptCancelled(ctx, cancelled);
    }
    return send(ctx, cid, t(lg, 'cancel_all_ok'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'm_book'), callback_data: CB.BOOK }],
      [{ text: t(lg, 'back_m'), callback_data: CB.MAIN }],
    ] } });
  }

  if (d.startsWith(CB.CANCEL_APT)) {
    const aptId = d.slice(CB.CANCEL_APT.length);
    if (!/^a\d+_\w+$/.test(aptId)) return;
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || apt.chatId !== cid || apt.cx) {
      return send(ctx, cid, t(lg, 'cancel_err'), mainKb(lg));
    }
    return send(ctx, cid, fill(t(lg, 'cancel_confirm'), {
      svc: svcName(ctx, lg, apt.svcId), dt: fmtDT(lg, apt.date, apt.time),
    }), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'cancel_yes'), callback_data: CB.CANCEL_APT_YES + aptId }],
      [{ text: t(lg, 'cancel_no'), callback_data: CB.MY }],
    ] } });
  }
}
