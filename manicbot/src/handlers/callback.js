import { CB, STEP, VALID_LANGS, LOCK_TTL_SEC, MAX_APTS } from '../config.js';
import { isInactive, canUse, getMastersLimit } from '../billing/features.js';
import { showInactiveMessage } from '../ui/billing.js';
import { escHtml, fill, t, svcName, isCorrectionSvc, isValidChatId, p2 } from '../utils/helpers.js';
import { isValidDate, isValidTime, fmtDate, fmtDT, warsawToUTC, warsawNow, dateStrForOffset, todayStr } from '../utils/date.js';
import { kvGet, kvPut } from '../utils/kv.js';
import { send, edit, answerCb, sendPhoto, api } from '../telegram.js';
import { getState, setState, clearState, checkRateLimit } from '../services/state.js';
import { getLang, setLang } from '../services/chat.js';
import { getUser, isAdmin, isMaster, isBlocked, canManageApt, getAdminId, getMaster, saveMaster, deleteMaster, blockUser, unblockUser, listMasters, isPlatformAdmin, getRole } from '../services/users.js';
import { saveServices, loadAboutPhotos, saveAboutPhotos } from '../services/services.js';
import { cancelApt, getApts, getSlots, getAdminAllApts, loadDayAppointments, saveApt } from '../services/appointments.js';
import { getTicket, setTicket, setTicketMaster, clearTicket, resetHumanRequestCount, buildTicketInternalNote } from '../services/tickets.js';
import { claimTicket, closeTicket } from '../support/tickets.js';
import { notifyAptStaff, sendAptConfirmedToClient, notifyStaffAptCancelled, notifyStaffConsultantRequest, confirmAllPendingApts } from '../notifications.js';
import { mainKb, langKb, svcKb, calKb, timeKb } from '../ui/keyboards.js';
import { showWelcome, showHomeByRole, showPrices, showContacts, showCatalog, showCatPhoto, showAbout, showMyApts, showLangPick, showReviews } from '../ui/screens.js';
import { showAdminPanel, showMasterPanel, showAdminApts, showAdminAllApts, showMasterAllApts, showMastersList, showClientsList, showServicesList, showServiceEdit, showServicePhotos, showAboutSettings, showAboutPhotos, showAboutDescEdit, showAboutInstagramEdit, showAdminCancelAllConfirm, showAdminSettings, showTenantSupportList } from '../ui/admin.js';
import { startBooking, startBookingWithService, showCancelAllConfirm, showMasterPick } from '../ui/booking.js';
import { showBillingMenu } from '../ui/billing.js';
import { createCheckoutSession, createPortalSession } from '../billing/stripe.js';
import { getTenant } from '../tenant/storage.js';
import { makeICS } from '../utils/ics.js';
import { showPlatformAdminPanel, showPlatformTenantsList, showPlatformTenantInfo, showPlatformSupportList, showPlatformLinks, showGrantRoleMenu, showPlatformTechSupportList } from '../ui/sysadmin.js';
import { addSupport, removeSupport, addTechnicalSupport, removeTechnicalSupport } from '../admin/provisioning.js';
import { getTechnicalSupportAgents, getTenantSupportAgents, addTenantSupportAgent, removeTenantSupportAgent } from '../roles/roles.js';
import { createCalendarEvent, deleteCalendarEvent, buildCalendarEvent } from '../services/calendar.js';

export async function onCb(ctx, cb) {
  if (!cb?.message?.chat?.id || !cb?.from || !cb?.data) return;
  if (cb.message.chat.type !== 'private') return;

  const cid = cb.message.chat.id;
  if (!isValidChatId(cid)) return;
  await answerCb(ctx, cb.id);

  const d = cb.data;
  if (d === CB.NOOP) return;

  const mid = cb.message.message_id;
  const rawName = cb.from.first_name || '';
  const name = escHtml(rawName.slice(0, 64)) || '👋';

  if (!await checkRateLimit(ctx, cid)) {
    const lg = (await getLang(ctx, cid)) || 'ru';
    return send(ctx, cid, t(lg, 'rate_limit'));
  }

  if (d.startsWith(CB.LANG_SET)) {
    const lang = d.slice(CB.LANG_SET.length);
    if (!VALID_LANGS.has(lang)) return;
    await setLang(ctx, cid, lang);
    await send(ctx, cid, t(lang, 'lang_set'));
    return showHomeByRole(ctx, cid, name);
  }

  const lg = (await getLang(ctx, cid)) || 'ru';

  if (await isBlocked(ctx, cid)) return send(ctx, cid, t(lg, 'client_blocked'));

  // Inactive/canceled billing: block all except billing-related callbacks for non-platform-admins
  if (isInactive(ctx) && !(await isPlatformAdmin(ctx, cid))) {
    const isBillingCb = d === CB.ADM_BILLING || d === CB.BILLING_PORTAL || d === CB.BILLING_BACK
      || d.startsWith(CB.BILLING_SUBSCRIBE) || d === CB.MAIN || d === CB.LANG;
    if (!isBillingCb) return showInactiveMessage(ctx, cid);
  }

  if (d === CB.MAIN)     return showHomeByRole(ctx, cid, name);
  if (d === CB.LANG)     return showLangPick(ctx, cid);
  if (d === CB.BOOK)     return startBooking(ctx, cid, cb.from);

  if (d === CB.SUPPORT) {
    // Support plan check only for salon staff — clients & platform roles always have support
    const supportRole = await getRole(ctx, cid);
    const isSalonStaffSupport = supportRole === 'admin' || supportRole === 'master' || supportRole === 'tenant_owner';
    if (isSalonStaffSupport && !canUse(ctx, 'support_tickets') && !(await isPlatformAdmin(ctx, cid))) {
      return send(ctx, cid, t(lg, 'feature_support_unavailable'));
    }
    await setState(ctx, cid, { step: STEP.SUPPORT_MSG });
    return send(ctx, cid, t(lg, 'support_enter_msg'), { reply_markup: { inline_keyboard: [[{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]] } });
  }

  if (d === CB.TECH_SUPPORT_REQ) {
    const role = await getRole(ctx, cid);
    if (role !== 'master' && role !== 'admin' && role !== 'tenant_owner' && role !== 'system_admin') return;
    await setState(ctx, cid, { step: STEP.TECH_SUPPORT_MSG });
    return send(ctx, cid, t(lg, 'tech_support_enter_msg'), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.ADM_MAIN }]] },
    });
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
    const declRole = await getRole(ctx, cid);
    if (!(await isAdmin(ctx, cid)) && !(await isMaster(ctx, cid)) && declRole !== 'support' && declRole !== 'technical_support') return;
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
      if (role !== 'support' && role !== 'admin' && role !== 'system_admin') return;
      const result = await claimTicket(ctx.globalKv, suffix, cid);
      if (result.ok) {
        const clientCid = result.ticket.clientChatId;
        // Set up local ticket routing so message forwarding works
        if (ctx.kv && clientCid) {
          await setTicket(ctx, clientCid, { open: true, masterCid: cid, since: Date.now(), globalTicketId: result.ticket.id });
          await setTicketMaster(ctx, cid, clientCid);
          // Notify client they've been connected
          const clg = await getLang(ctx, clientCid) || 'ru';
          const masterName = escHtml((cb.from?.first_name || '').trim() || 'Агент');
          try { await send(ctx, clientCid, fill(t(clg, 'ticket_taken_by'), { name: masterName })); } catch (_) {}
        }
        await send(ctx, cid,
          t(lg, 'ticket_master_hint') +
          '\n\n🆘 Тикет #' + result.ticket.id +
          '\nКлиент: ' + escHtml(result.ticket.clientName || '—') +
          (clientCid ? '\nID: <code>' + clientCid + '</code>' : ''),
          { reply_markup: { inline_keyboard: [
            [{ text: t(lg, 'ticket_close_btn'), callback_data: CB.TICKET_CLOSE + (clientCid || result.ticket.id) }],
          ] } }
        );
      } else {
        await send(ctx, cid, result.error === 'Claim race lost' ? t(lg, 'ticket_taken_else') : '❌ ' + (result.error || 'Error'));
      }
      return;
    }
    const clientCid = parseInt(suffix, 10);
    if (!clientCid) return;
    if (cid === clientCid) {
      return send(ctx, cid, t(lg, 'ticket_cannot_take_own'));
    }
    const agentRole = await getRole(ctx, cid);
    const tenantAgents = ctx.kv ? await getTenantSupportAgents(ctx).catch(() => []) : [];
    const isSupportAgent = tenantAgents.includes(cid) || tenantAgents.includes(String(cid));
    if (!(await isAdmin(ctx, cid)) && !(await isMaster(ctx, cid)) && !isSupportAgent && agentRole !== 'technical_support' && agentRole !== 'system_admin') return;
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
    if (!(await isAdmin(ctx, cid)) && !(await isMaster(ctx, cid)) && (await getRole(ctx, cid)) !== 'support') return;
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
    const closeRole = await getRole(ctx, cid);
    if (!ticket || (ticket.masterCid !== cid && !(await isAdmin(ctx, cid)) && closeRole !== 'technical_support' && closeRole !== 'system_admin')) return;
    // Also close the global platform ticket if linked
    if (ticket.globalTicketId && ctx.globalKv) {
      try { await closeTicket(ctx.globalKv, ticket.globalTicketId); } catch (_) {}
    }
    await clearTicket(ctx, clientCid);
    const clg = await getLang(ctx, clientCid) || 'ru';
    await send(ctx, clientCid, t(clg, 'ticket_closed'), { reply_markup: { remove_keyboard: true } });
    const clientUser = await getUser(ctx, clientCid);
    const clientName = (clientUser?.name && escHtml(clientUser.name.slice(0, 64))) || '👋';
    await showWelcome(ctx, clientCid, clientName);
    if (cid !== clientCid) await send(ctx, cid, t(lg, 'ticket_closed_master'));
    return;
  }

  // ─── Панель платформы: только в главном боте (без tenantId) и только для создателя платформы ─────────────────
  // Platform panel is ONLY for isPlatformAdmin (ADMIN_CHAT_ID or system_admin in KV). Support no longer sees it.
  // В тенантных ботах никогда не показываем сообщения про «нет доступа» — только главное меню.
  const canPlatform = !ctx.tenantId && (await isPlatformAdmin(ctx, cid));
  const noAccessMsg = () => (ctx.tenantId ? showWelcome(ctx, cid, name) : send(ctx, cid, t(lg, 'sysadm_no_access')));

  if (d === CB.SYSADM_MAIN || d === CB.SYSADM_BACK) {
    if (!canPlatform) return noAccessMsg();
    return showPlatformAdminPanel(ctx, cid, name);
  }

  if (d === CB.SYSADM_TENANTS) {
    if (!canPlatform) return noAccessMsg();
    return showPlatformTenantsList(ctx, cid);
  }

  if (d === CB.SYSADM_NEW_TENANT) {
    if (!(await isPlatformAdmin(ctx, cid))) return noAccessMsg();
    await setState(ctx, cid, { step: STEP.SYSADM_NEW_TENANT });
    return send(ctx, cid, t(lg, 'sysadm_salon_enter_name'), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.SYSADM_MAIN }]] },
    });
  }

  if (d === CB.SYSADM_BOT_NEW) {
    if (!(await isPlatformAdmin(ctx, cid))) return noAccessMsg();
    await setState(ctx, cid, { step: STEP.SYSADM_NEW_BOT });
    return send(ctx, cid, t(lg, 'sysadm_bot_enter_token'), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.SYSADM_MAIN }]] },
    });
  }

  if (d.startsWith(CB.SYSADM_BOT_NEW_FOR)) {
    if (!(await isPlatformAdmin(ctx, cid))) return noAccessMsg();
    const preTenantId = d.slice(CB.SYSADM_BOT_NEW_FOR.length);
    await setState(ctx, cid, { step: STEP.SYSADM_NEW_BOT, preTenantId });
    return send(ctx, cid, t(lg, 'sysadm_bot_enter_token'), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.SYSADM_TENANT_INFO + preTenantId }]] },
    });
  }

  if (d === CB.SYSADM_SUPPORT_LIST) {
    if (!canPlatform) return noAccessMsg();
    await clearState(ctx, cid);
    return showPlatformSupportList(ctx, cid);
  }

  if (d.startsWith(CB.SYSADM_TENANT_INFO)) {
    if (!canPlatform) return noAccessMsg();
    const tenantId = d.slice(CB.SYSADM_TENANT_INFO.length);
    return showPlatformTenantInfo(ctx, cid, tenantId);
  }

  if (d === CB.SYSADM_LINKS) {
    if (!canPlatform) return noAccessMsg();
    return showPlatformLinks(ctx, cid);
  }

  if (d === CB.SYSADM_SUPPORT_ADD) {
    if (!(await isPlatformAdmin(ctx, cid))) return noAccessMsg();
    await setState(ctx, cid, { step: STEP.SYSADM_ADD_SUPPORT });
    return send(ctx, cid, t(lg, 'sysadm_support_enter_user'), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.SYSADM_SUPPORT_LIST }]] },
    });
  }

  if (d.startsWith(CB.SYSADM_SUPPORT_REMOVE)) {
    if (!(await isPlatformAdmin(ctx, cid))) return noAccessMsg();
    const agentChatId = d.slice(CB.SYSADM_SUPPORT_REMOVE.length).trim();
    if (!agentChatId || !ctx.globalKv) return showPlatformSupportList(ctx, cid);
    await removeSupport(ctx.globalKv, agentChatId);
    await send(ctx, cid, t(lg, 'sysadm_support_removed'));
    return showPlatformSupportList(ctx, cid);
  }

  if (d === CB.SYSADM_TECH_SUPPORT_LIST) {
    if (!(await isPlatformAdmin(ctx, cid))) return noAccessMsg();
    await clearState(ctx, cid);
    return showPlatformTechSupportList(ctx, cid);
  }

  if (d === CB.SYSADM_TECH_SUPPORT_ADD) {
    if (!(await isPlatformAdmin(ctx, cid))) return noAccessMsg();
    await setState(ctx, cid, { step: STEP.SYSADM_ADD_TECH_SUPPORT });
    return send(ctx, cid, t(lg, 'sysadm_tech_support_enter_user'), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.SYSADM_TECH_SUPPORT_LIST }]] },
    });
  }

  if (d.startsWith(CB.SYSADM_TECH_SUPPORT_REMOVE)) {
    if (!(await isPlatformAdmin(ctx, cid))) return noAccessMsg();
    const agentChatId = d.slice(CB.SYSADM_TECH_SUPPORT_REMOVE.length).trim();
    if (!agentChatId || !ctx.globalKv) return showPlatformTechSupportList(ctx, cid);
    await removeTechnicalSupport(ctx.globalKv, agentChatId);
    await send(ctx, cid, t(lg, 'sysadm_tech_support_removed'));
    return showPlatformTechSupportList(ctx, cid);
  }

  if (d === CB.ADM_SUPPORT_LIST) {
    if (!await isAdmin(ctx, cid)) return;
    await clearState(ctx, cid);
    return showTenantSupportList(ctx, cid);
  }

  if (d === CB.ADM_SUPPORT_ADD) {
    if (!await isAdmin(ctx, cid)) return;
    await setState(ctx, cid, { step: STEP.ADM_ADD_TENANT_SUPPORT });
    return send(ctx, cid, t(lg, 'adm_support_enter_user'), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.ADM_SUPPORT_LIST }]] },
    });
  }

  if (d.startsWith(CB.ADM_SUPPORT_REMOVE)) {
    if (!await isAdmin(ctx, cid)) return;
    const agentChatId = parseInt(d.slice(CB.ADM_SUPPORT_REMOVE.length).trim(), 10);
    if (!agentChatId || !ctx.kv) return showTenantSupportList(ctx, cid);
    await removeTenantSupportAgent(ctx, agentChatId);
    await send(ctx, cid, t(lg, 'adm_support_removed'));
    return showTenantSupportList(ctx, cid);
  }

  if (d === CB.SYSADM_GRANT_ROLE) {
    if (!(await isPlatformAdmin(ctx, cid))) return noAccessMsg();
    return showGrantRoleMenu(ctx, cid);
  }

  if (d === CB.SYSADM_GRANT_MASTER || d === CB.SYSADM_GRANT_OWNER) {
    if (!(await isPlatformAdmin(ctx, cid))) return noAccessMsg();
    const role = d === CB.SYSADM_GRANT_OWNER ? 'salon' : 'master';
    await setState(ctx, cid, { step: STEP.SYSADM_GRANT_INPUT, grantRole: role });
    return send(ctx, cid, fill(t(lg, 'sysadm_grant_enter_user'), { role }), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.SYSADM_GRANT_ROLE }]] },
    });
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (d === CB.ADM_SETTINGS) {
    if (!await isAdmin(ctx, cid)) return;
    return showAdminSettings(ctx, cid);
  }

  if (d === CB.ADM_SETTINGS_NAME || d === CB.ADM_SETTINGS_PHONE || d === CB.ADM_SETTINGS_ADDR || d === CB.ADM_SETTINGS_HOURS) {
    if (!await isAdmin(ctx, cid)) return;
    const stepMap = {
      [CB.ADM_SETTINGS_NAME]:  { step: STEP.EDIT_SALON_NAME,  key: 'adm_settings_enter_name' },
      [CB.ADM_SETTINGS_PHONE]: { step: STEP.EDIT_SALON_PHONE, key: 'adm_settings_enter_phone' },
      [CB.ADM_SETTINGS_ADDR]:  { step: STEP.EDIT_SALON_ADDR,  key: 'adm_settings_enter_addr' },
      [CB.ADM_SETTINGS_HOURS]: { step: STEP.EDIT_SALON_HOURS_FROM, key: 'adm_settings_enter_hours' },
    };
    const { step, key } = stepMap[d];
    await setState(ctx, cid, { step });
    return send(ctx, cid, t(lg, key), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.ADM_SETTINGS }]] },
    });
  }

  if (d === CB.ADM_MAIN) {
    if (await isAdmin(ctx, cid)) return showAdminPanel(ctx, cid, name);
    if (await isMaster(ctx, cid)) return showMasterPanel(ctx, cid, name);
    return;
  }

  if (d === CB.ADM_BILLING) {
    if (!await isAdmin(ctx, cid)) return;
    if (!ctx.tenantId || !ctx.globalKv) return send(ctx, cid, t(lg, 'billing_no_config'));
    return showBillingMenu(ctx, cid, name);
  }

  if (d.startsWith(CB.BILLING_SUBSCRIBE)) {
    if (!await isAdmin(ctx, cid)) return;
    if (!ctx.tenantId || !ctx.globalKv) return send(ctx, cid, t(lg, 'billing_no_config'));
    const plan = d.slice(CB.BILLING_SUBSCRIBE.length);
    const baseUrl = ctx.baseUrl || '';
    const tenant = await getTenant(ctx.globalKv, ctx.tenantId);
    const result = await createCheckoutSession(ctx, {
      tenantId: ctx.tenantId,
      customerId: tenant?.stripeCustomerId || undefined,
      customer_email: tenant?.billingEmail || undefined,
      plan,
      successUrl: baseUrl ? `${baseUrl}/stripe/success?session_id={CHECKOUT_SESSION_ID}` : undefined,
      cancelUrl: baseUrl ? `${baseUrl}/` : undefined,
    });
    if (result.error) return send(ctx, cid, t(lg, 'billing_no_config') + '\n' + result.error);
    if (result.url) {
      await send(ctx, cid, t(lg, 'billing_checkout_sent') + '\n\n' + result.url);
      return showBillingMenu(ctx, cid, name);
    }
    return send(ctx, cid, t(lg, 'billing_no_config'));
  }

  if (d === CB.BILLING_PORTAL) {
    if (!await isAdmin(ctx, cid)) return;
    if (!ctx.tenantId || !ctx.globalKv) return send(ctx, cid, t(lg, 'billing_no_config'));
    const tenant = await getTenant(ctx.globalKv, ctx.tenantId);
    if (!tenant?.stripeCustomerId) return send(ctx, cid, t(lg, 'billing_no_config'));
    const baseUrl = ctx.baseUrl || '';
    const result = await createPortalSession(ctx, {
      customerId: tenant.stripeCustomerId,
      returnUrl: baseUrl ? `${baseUrl}/` : undefined,
    });
    if (result.error) return send(ctx, cid, t(lg, 'billing_no_config') + '\n' + result.error);
    if (result.url) {
      await send(ctx, cid, t(lg, 'billing_portal_sent') + '\n\n' + result.url);
      return showBillingMenu(ctx, cid, name);
    }
    return send(ctx, cid, t(lg, 'billing_no_config'));
  }

  if (d === CB.BILLING_BACK) {
    if (await isAdmin(ctx, cid)) return showAdminPanel(ctx, cid, name);
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
    const currentMasters = await listMasters(ctx);
    const mastersLimit = getMastersLimit(ctx);
    if (currentMasters.length >= mastersLimit) {
      return send(ctx, cid, fill(t(lg, 'feature_masters_limit'), { limit: String(mastersLimit) }));
    }
    await setState(ctx, cid, { step: STEP.ADD_MASTER });
    return send(ctx, cid, t(lg, 'adm_enter_master_id'));
  }

  if (d.startsWith(CB.ADM_RENAME_M)) {
    if (!await isAdmin(ctx, cid)) return;
    const mId = parseInt(d.slice(CB.ADM_RENAME_M.length));
    if (!mId) return showMastersList(ctx, cid);
    const m = await getMaster(ctx, mId);
    if (!m) return showMastersList(ctx, cid);
    await setState(ctx, cid, { step: STEP.RENAME_MASTER, renameMasterId: mId });
    return send(ctx, cid, t(lg, 'adm_rename_master_prompt'), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.ADM_MASTERS }]] },
    });
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

  // Admin: show master list to assign to an appointment
  if (d.startsWith(CB.ADM_ASSIGN_M)) {
    if (!await isAdmin(ctx, cid)) return;
    const aptId = d.slice(CB.ADM_ASSIGN_M.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || apt.cx) return;
    const masters = (await listMasters(ctx)).filter(m => !m.onVacation);
    if (!masters.length) return send(ctx, cid, t(lg, 'adm_no_masters'));
    const btns = masters.map(m => [{ text: `👤 ${escHtml(m.name)}`, callback_data: CB.ADM_SET_M + aptId + ':' + m.chatId }]);
    btns.push([{ text: (ctx.tenantId ? t(lg, 'back_m') : t(lg, 'adm_back')), callback_data: CB.ADM_MAIN }]);
    return send(ctx, cid, t(lg, 'adm_assign_master_prompt'), { reply_markup: { inline_keyboard: btns } });
  }

  // Admin: set specific master for appointment
  if (d.startsWith(CB.ADM_SET_M)) {
    if (!await isAdmin(ctx, cid)) return;
    const parts = d.slice(CB.ADM_SET_M.length).split(':');
    const aptId = parts[0];
    const masterId = parseInt(parts[1]);
    if (!aptId || !masterId) return;
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || apt.cx) return;
    const master = await getMaster(ctx, masterId);
    if (!master) return;
    apt.masterId = masterId;
    await kvPut(ctx, `ap:${aptId}`, apt);
    // Notify the assigned master
    const mlg = await getLang(ctx, masterId) || 'ru';
    const s = ctx.svc.find(x => x.id === apt.svcId);
    const priceLine = '💵 ' + String(s?.price || '?') + ' ' + t(mlg, 'cur');
    await send(ctx, masterId, [
      '👩‍🎨 <b>' + t(mlg, 'mst_new_apt_header') + '</b>',
      '',
      '👤 ' + escHtml(apt.userName),
      '📱 ' + escHtml(apt.userPhone),
      apt.userTg ? '🔗 @' + escHtml(apt.userTg) : '',
      '',
      '💅 ' + svcName(ctx, mlg, apt.svcId),
      '',
      '📅 ' + fmtDT(mlg, apt.date, apt.time),
      priceLine,
    ].filter(Boolean).join('\n'), { reply_markup: { inline_keyboard: [
      [{ text: t(mlg, 'mst_confirm_btn'), callback_data: CB.APT_CONFIRM + aptId }],
      [{ text: t(mlg, 'mst_reject_btn'), callback_data: CB.APT_REJECT + aptId }],
      [{ text: t(mlg, 'mst_counter_btn'), callback_data: CB.APT_COUNTER + aptId }],
    ]}}).catch(() => null);
    return send(ctx, cid, fill(t(lg, 'adm_master_assigned_ok'), { name: escHtml(master.name) }));
  }

  if (d === CB.ADM_ALL_APTS) {
    if (!await isAdmin(ctx, cid)) return;
    return showAdminAllApts(ctx, cid, null);
  }

  if (d.startsWith(CB.ADM_ALL_APTS_M)) {
    if (!await isAdmin(ctx, cid)) return;
    const masterId = parseInt(d.slice(CB.ADM_ALL_APTS_M.length));
    return showAdminAllApts(ctx, cid, masterId || null);
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
    return send(ctx, cid, fill(t(lg, 'adm_cancel_all_done'), { n: String(count) }), { reply_markup: { inline_keyboard: [[{ text: (ctx.tenantId ? t(lg, 'back_m') : t(lg, 'adm_back')), callback_data: CB.ADM_MAIN }]] } });
  }

  if (d.startsWith(CB.APT_CONFIRM)) {
    if (!await canManageApt(ctx, cid)) return;
    const aptId = d.slice(CB.APT_CONFIRM.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    apt.status = 'confirmed';
    apt.confirmedBy = cid;
    // If no master was pre-assigned, the confirming master claims the appointment
    if (!apt.masterId) apt.masterId = cid;
    await kvPut(ctx, `ap:${aptId}`, apt);
    await sendAptConfirmedToClient(ctx, apt);
    // Google Calendar: create event if master has calendar connected
    if (canUse(ctx, 'calendar') && ctx.GOOGLE_SERVICE_ACCOUNT_KEY) {
      try {
        const masterId = apt.masterId || cid;
        const master = await getMaster(ctx, masterId);
        if (master?.googleCalendarId && master?.calendarEnabled) {
          const svcObj = ctx.svc?.find(s => s.id === apt.svcId);
          const event = buildCalendarEvent(apt, svcObj, ctx.tenant?.salon, ctx.tenant?.salon?.timezone || 'Europe/Warsaw');
          const created = await createCalendarEvent(ctx, master.googleCalendarId, event);
          if (created?.id) {
            apt.googleEventId = created.id;
            apt.googleCalendarId = master.googleCalendarId;
            await kvPut(ctx, `ap:${aptId}`, apt);
          }
        }
      } catch (e) {
        console.error('Calendar event creation failed:', e.message);
      }
    }
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

  // ─── Google Calendar (master) ────────────────────────────────────────────
  if (d === CB.MST_CALENDAR) {
    if (!await isMaster(ctx, cid) && !await isAdmin(ctx, cid)) return;
    if (!canUse(ctx, 'calendar')) return send(ctx, cid, t(lg, 'feature_calendar_unavailable'));
    const master = await getMaster(ctx, cid) || {};
    const isOn = master.googleCalendarId && master.calendarEnabled;
    const statusText = isOn
      ? `${t(lg, 'mst_calendar_status_on')}: <code>${escHtml(master.googleCalendarId)}</code>`
      : t(lg, 'mst_calendar_status_off');
    const rows = [
      [{ text: t(lg, 'mst_calendar_setup_btn'), callback_data: CB.MST_CALENDAR_SET }],
    ];
    if (isOn) rows.push([{ text: t(lg, 'mst_calendar_clear_btn'), callback_data: CB.MST_CALENDAR_CLEAR }]);
    rows.push([{ text: t(lg, 'back'), callback_data: CB.MST_MAIN }]);
    return send(ctx, cid, `📅 <b>${t(lg, 'mst_calendar')}</b>\n\n${statusText}`, { reply_markup: { inline_keyboard: rows } });
  }

  if (d === CB.MST_CALENDAR_SET) {
    if (!await isMaster(ctx, cid) && !await isAdmin(ctx, cid)) return;
    if (!canUse(ctx, 'calendar')) return send(ctx, cid, t(lg, 'feature_calendar_unavailable'));
    await setState(ctx, cid, { step: STEP.SET_CALENDAR_ID });
    return send(ctx, cid, t(lg, 'mst_calendar_enter_id'), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.MST_CALENDAR }]] },
    });
  }

  if (d === CB.MST_CALENDAR_CLEAR) {
    if (!await isMaster(ctx, cid) && !await isAdmin(ctx, cid)) return;
    const master = await getMaster(ctx, cid) || {};
    await saveMaster(ctx, cid, { ...master, googleCalendarId: null, calendarEnabled: false });
    return send(ctx, cid, t(lg, 'mst_calendar_cleared'), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.MST_CALENDAR }]] },
    });
  }
  // ─────────────────────────────────────────────────────────────────────────

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
    st.date = date;
    // Route through master selection if salon has masters
    return showMasterPick(ctx, cid, st.svcId, date, st);
  }

  if (d === CB.CAL_BACK) return send(ctx, cid, t(lg, 'choose_date'), calKb(lg, 0));

  // Master selection: "any available master"
  if (d === CB.MASTER_ANY) {
    const st = await getState(ctx, cid);
    if (!st.svcId || !st.date || !ctx.svcIds.has(st.svcId)) return send(ctx, cid, t(lg, 'book_err'), svcKb(ctx, lg));
    const slots = await getSlots(ctx, st.date, st.svcId, null);
    if (!slots.length) return send(ctx, cid, fill(t(lg, 'no_slots'), { d: fmtDate(lg, st.date) }), calKb(lg, 0));
    await setState(ctx, cid, { ...st, step: STEP.TIME, masterId: null });
    await send(ctx, cid, `📅 <b>${fmtDate(lg, st.date)}</b>\n${svcName(ctx, lg, st.svcId)}\n${t(lg, 'book_any_master_label')}\n\n${t(lg, 'choose_time')}`, timeKb(slots, lg));
    return;
  }

  // Master selection: specific master chosen
  if (d.startsWith(CB.MASTER_SEL)) {
    const masterId = parseInt(d.slice(CB.MASTER_SEL.length));
    if (!masterId) return;
    const st = await getState(ctx, cid);
    if (!st.svcId || !st.date || !ctx.svcIds.has(st.svcId)) return send(ctx, cid, t(lg, 'book_err'), svcKb(ctx, lg));
    const master = await getMaster(ctx, masterId);
    if (!master || master.onVacation) return send(ctx, cid, t(lg, 'book_err'), svcKb(ctx, lg));
    const slots = await getSlots(ctx, st.date, st.svcId, masterId);
    if (!slots.length) return send(ctx, cid, fill(t(lg, 'no_slots'), { d: fmtDate(lg, st.date) }), calKb(lg, 0));
    await setState(ctx, cid, { ...st, step: STEP.TIME, masterId });
    await send(ctx, cid, `📅 <b>${fmtDate(lg, st.date)}</b>\n${svcName(ctx, lg, st.svcId)}\n${fill(t(lg, 'book_master_assigned'), { name: escHtml(master.name) })}\n\n${t(lg, 'choose_time')}`, timeKb(slots, lg));
    return;
  }

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
      masterId: st.masterId || null,
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
