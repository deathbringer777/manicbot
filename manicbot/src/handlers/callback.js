import { CB, STEP, VALID_LANGS, LOCK_TTL_SEC, MAX_APTS } from '../config.js';
import { log } from '../utils/logger.js';
import { isInactive, canUse, getMastersLimit } from '../billing/features.js';
import { escHtml, fill, t, svcName, isCorrectionSvc, isValidChatId, p2, safeParseInt } from '../utils/helpers.js';
import { isValidDate, isValidTime, fmtDate, fmtDT, warsawToUTC, warsawNow, dateStrForOffset, todayStr } from '../utils/date.js';
import { kvGet, kvPut } from '../utils/kv.js';
import { send, edit, answerCb, api } from '../telegram.js';
import { getState, setState, clearState, checkRateLimit } from '../services/state.js';
import { getLang, setLang } from '../services/chat.js';
import { getUser, isAdmin, isMaster, isBlocked, canManageApt, getAdminId, getMaster, saveMaster, deleteMaster, blockUser, unblockUser, listMasters, isPlatformAdmin, getRole, isRegComplete } from '../services/users.js';
import { saveServices, loadAboutPhotos, saveAboutPhotos, getAutoConfirm } from '../services/services.js';
import { cancelApt, getApts, getSlots, getAdminAllApts, loadDayAppointments, saveApt, SLOT_TAKEN, getAptById, updateApt } from '../services/appointments.js';
import { getTicket, setTicket, setTicketMaster, clearTicket, resetHumanRequestCount, buildTicketInternalNote } from '../services/tickets.js';
import { claimTicket, closeTicket } from '../support/tickets.js';
import { notifyAptStaff, notifyAptStaffAutoConfirmed, sendAptConfirmedToClient, notifyStaffAptCancelled, notifyStaffConsultantRequest, confirmAllPendingApts } from '../notifications.js';
import { mainKb, langKb, svcKb, calKb, timeKb } from '../ui/keyboards.js';
import { showWelcome, showHomeByRole, showPrices, showContacts, showCatalog, showCatPhoto, showAbout, showMyApts, showLangPick, showReviews } from '../ui/screens.js';
import { showAdminPanel, showMasterPanel, showAdminApts, showAdminAllApts, showMasterAllApts, showMastersList, showClientsList, showServicesList, showServiceEdit, showServicePhotos, showAboutSettings, showAboutPhotos, showAboutDescEdit, showAboutInstagramEdit, showAdminSettings, showTenantSupportList, showMetaChannelsGuide } from '../ui/admin.js';
import { startBooking, startBookingWithService, showCancelAllConfirm, showMasterPick, enterBookingAdjustState } from '../ui/booking.js';
import { showBillingMenu, showInactiveMessage } from '../ui/billing.js';
import { createCheckoutSession, createPortalSession } from '../billing/stripe.js';
import { getTenant } from '../tenant/storage.js';
import { showPlatformAdminPanel, showPlatformTenantsList, showPlatformTenantInfo, showPlatformSupportList, showPlatformLinks, showGrantRoleMenu, showPlatformTechSupportList } from '../ui/sysadmin.js';
import { createReview, getReviewByApt, getReviewById, updateReviewText, addReviewPhoto } from '../services/reviews.js';
import { addSupport, removeSupport, addTechnicalSupport, removeTechnicalSupport } from '../admin/provisioning.js';
import { getTechnicalSupportAgents, getTenantSupportAgents, addTenantSupportAgent, removeTenantSupportAgent } from '../roles/roles.js';
import {
  createGoogleConnectUrl,
  getGoogleIntegration,
  revokeGoogleIntegration,
  syncAppointmentCalendar,
  syncGoogleIntegrationNow,
  deleteAppointmentCalendar,
} from '../services/google-calendar-oauth.js';

function fmtAuditTs(ts) {
  if (!ts) return null;
  return new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
}

async function showGoogleCalendarPanel(
  ctx,
  cid,
  lg,
  { scope = 'master', masterChatId = cid, backCb = CB.MST_MAIN, notice = null } = {},
) {
  if (scope === 'tenant' && (!ctx?.db || !ctx?.tenantId)) {
    return send(ctx, cid, t(lg, 'adm_settings_no_tenant'));
  }

  const integration = await getGoogleIntegration(ctx, {
    scope,
    masterChatId: scope === 'master' ? masterChatId : null,
  });
  const master = scope === 'master' ? (await getMaster(ctx, masterChatId) || {}) : null;
  const legacyConnected = !!(scope === 'master' && master?.googleCalendarId && master?.calendarEnabled);
  const connectUrl = await createGoogleConnectUrl(ctx, {
    scope,
    actorChatId: cid,
    masterChatId: scope === 'master' ? masterChatId : null,
  });

  const lines = [`📅 <b>${t(lg, 'mst_calendar')}</b>`];
  if (notice) lines.push('', notice);
  lines.push('', scope === 'tenant' ? t(lg, 'gcal_scope_salon') : t(lg, 'gcal_scope_master'));

  if (integration) {
    lines.push(`${t(lg, 'mst_calendar_status_on')}: <code>${escHtml(integration.calendarSummary || integration.calendarId)}</code>`);
    if (integration.providerAccountEmail) {
      lines.push(`👤 Google: <code>${escHtml(integration.providerAccountEmail)}</code>`);
    }
    if (integration.watchExpiration && integration.watchExpiration > Date.now()) {
      lines.push(fill(t(lg, 'gcal_watch_active'), { date: escHtml(fmtAuditTs(integration.watchExpiration) || '') }));
    }
    if (integration.lastSyncAt) {
      const suffix = integration.lastSyncStatus && integration.lastSyncStatus !== 'ok'
        ? ` (${escHtml(integration.lastSyncStatus)})`
        : '';
      lines.push(fill(t(lg, 'gcal_sync_time'), { time: escHtml(fmtAuditTs(integration.lastSyncAt) || '') }) + suffix);
    }
    if (integration.lastSyncError) {
      lines.push(`⚠️ ${escHtml(integration.lastSyncError)}`);
    }
  } else if (legacyConnected) {
    lines.push(`${t(lg, 'mst_calendar_status_on')}: <code>${escHtml(master.googleCalendarId)}</code>`);
    lines.push(t(lg, 'gcal_legacy_mode'));
  } else {
    lines.push(t(lg, 'mst_calendar_status_off'));
  }

  if (!connectUrl) {
    if (!ctx?.db || !ctx?.tenantId) {
      lines.push('ℹ️ OAuth mode works in D1 multi-tenant mode.');
    } else {
      lines.push('ℹ️ Configure GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to enable OAuth.');
    }
  }

  const rows = [];
  const hasOAuthIntegration = !!integration;
  const hasError = !!(integration?.lastSyncError || (integration?.lastSyncStatus && integration.lastSyncStatus !== 'ok'));

  if (connectUrl) {
    if (!hasOAuthIntegration) {
      // Not connected yet — show Connect button (also shown for legacy mode to encourage upgrade)
      rows.push([{ text: t(lg, 'gcal_oauth_btn'), url: connectUrl }]);
    } else if (hasError) {
      // Connected but sync failed — offer re-authentication
      rows.push([{ text: t(lg, 'gcal_reauth_btn'), url: connectUrl }]);
    }
    // Connected successfully — OAuth button is hidden (no need to re-auth)
  }
  if (integration) {
    rows.push([{ text: t(lg, 'gcal_sync_now_btn'), callback_data: scope === 'tenant' ? CB.ADM_CALENDAR_RESYNC : CB.MST_CALENDAR_RESYNC }]);
  }
  if (scope === 'master' && ctx.GOOGLE_SERVICE_ACCOUNT_KEY) {
    rows.push([{ text: t(lg, 'gcal_manual_id_btn'), callback_data: CB.MST_CALENDAR_SET }]);
  }
  if (integration || legacyConnected) {
    rows.push([{ text: t(lg, 'mst_calendar_clear_btn'), callback_data: scope === 'tenant' ? CB.ADM_CALENDAR_CLEAR : CB.MST_CALENDAR_CLEAR }]);
  }
  rows.push([{ text: t(lg, 'back'), callback_data: backCb }]);

  return send(ctx, cid, lines.join('\n'), { reply_markup: { inline_keyboard: rows } });
}

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

  // Sprint 3 §8: post-visit confirmation callbacks (master clicks Yes/No-show).
  if (d.startsWith('visit_ok:') || d.startsWith('visit_noshow:')) {
    const aptId = d.split(':', 2)[1];
    const isOk = d.startsWith('visit_ok:');
    const { dbGet: _dbGet, dbRun: _dbRun } = await import('../utils/db.js');
    const apt = await _dbGet(ctx,
      'SELECT * FROM appointments WHERE id = ? AND tenant_id = ?',
      aptId, ctx.tenantId,
    ).catch(() => null);
    if (!apt) {
      return send(ctx, cid, 'Запись не найдена или уже обработана.');
    }
    // Only the assigned master (or owner/system_admin) can confirm
    const role = await getRole(ctx, cid);
    const isAuthorized = (apt.master_id && Number(apt.master_id) === Number(cid))
      || role === 'tenant_owner'
      || role === 'system_admin';
    if (!isAuthorized) {
      return send(ctx, cid, 'Нет доступа к этой записи.');
    }
    const now = Math.floor(Date.now() / 1000);
    const newStatus = isOk ? 'done' : 'no_show';
    await _dbRun(ctx,
      `UPDATE appointments
       SET status = ?, visit_confirmed_at = ?, visit_confirmed_by = 'master',
           no_show = ?, no_show_by = ?
       WHERE id = ? AND tenant_id = ?`,
      newStatus, now, isOk ? 0 : 1, isOk ? null : 'master', aptId, ctx.tenantId,
    );
    // Analytics
    await _dbRun(ctx, `
      INSERT INTO analytics_events (tenant_id, user_id, event, properties, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, ctx.tenantId, String(cid),
       isOk ? 'booking.completed' : 'booking.no_show',
       JSON.stringify({ appointmentId: aptId, confirmedBy: 'master' }), now).catch(() => {});

    // On success, ask the client to leave a review (best-effort)
    if (isOk && apt.chat_id > 0) {
      const { markReviewRequested: mrr } = await import('../services/reviews.js');
      await mrr(ctx, aptId).catch(() => {});
      await send(ctx, apt.chat_id,
        'Надеемся, вам понравилось! Поставьте оценку от 1 до 5:',
        {
          reply_markup: {
            inline_keyboard: [[
              { text: '⭐1', callback_data: `rate:${aptId}:1` },
              { text: '⭐2', callback_data: `rate:${aptId}:2` },
              { text: '⭐3', callback_data: `rate:${aptId}:3` },
              { text: '⭐4', callback_data: `rate:${aptId}:4` },
              { text: '⭐5', callback_data: `rate:${aptId}:5` },
            ]],
          },
        },
      ).catch(() => {});
    }
    // Stamp-card increment on a confirmed visit (Sprint 4).
    // #N-02 — failures here MUST NOT block the rest of the callback flow
    // (the visit is already confirmed) but they used to be swallowed
    // silently, hiding loyalty-program drift. Log them via the structured
    // logger so they show up in dashboards / error_log.
    if (isOk && apt.chat_id) {
      try {
        const cfg = await _dbGet(ctx,
          'SELECT enabled, visits_required FROM stamp_card_configs WHERE tenant_id = ?',
          ctx.tenantId,
        );
        if (cfg && cfg.enabled) {
          await _dbRun(ctx, `
            INSERT INTO stamp_card_progress (tenant_id, client_id, visits_completed, last_visit_at)
            VALUES (?, ?, 1, ?)
            ON CONFLICT(tenant_id, client_id) DO UPDATE SET
              visits_completed = visits_completed + 1,
              last_visit_at = excluded.last_visit_at
          `, ctx.tenantId, String(apt.chat_id), now)
            .catch((e) => log.warn('callback.stampCard', { phase: 'increment', tenantId: ctx.tenantId, aptId, message: e?.message || String(e) }));
        }
      } catch (e) {
        log.warn('callback.stampCard', { phase: 'config_lookup', tenantId: ctx.tenantId, aptId, message: e?.message || String(e) });
      }
    }
    return send(ctx, cid, isOk ? '✅ Визит отмечен выполненным.' : '❌ Визит отмечен как no-show.');
  }

  const lg = (await getLang(ctx, cid)) || 'ru';

  if (await isBlocked(ctx, cid)) return send(ctx, cid, t(lg, 'client_blocked'));

  // Inactive/canceled billing: block staff callbacks, let clients through freely
  if (isInactive(ctx) && !(await isPlatformAdmin(ctx, cid))) {
    const role = await getRole(ctx, cid);
    if (role !== 'client') {
      const isBillingCb = d === CB.ADM_BILLING || d === CB.BILLING_PORTAL || d === CB.BILLING_BACK
        || d.startsWith(CB.BILLING_SUBSCRIBE) || d === CB.MAIN || d === CB.CLIENT_VIEW || d === CB.LANG;
      if (!isBillingCb) return showInactiveMessage(ctx, cid);
    }
  }

  if (d === CB.MAIN)        return showHomeByRole(ctx, cid, name);
  if (d === CB.CLIENT_VIEW) return showWelcome(ctx, cid, name);
  if (d === CB.LANG)        return showLangPick(ctx, cid);
  if (d === CB.BOOK)     return startBooking(ctx, cid, cb.from);

  if (d === CB.BOOK_PICK_SVC) {
    const st = await getState(ctx, cid);
    if (st.step !== STEP.BOOK_ADJUST) return;
    return send(ctx, cid, t(lg, 'book_choose_svc_adjust'), svcKb(ctx, lg));
  }

  if (d === CB.SUPPORT) {
    // Support plan check only for salon staff — clients & platform roles always have support
    const supportRole = await getRole(ctx, cid);
    const isSalonStaffSupport = supportRole === 'tenant_owner' || supportRole === 'master';
    if (isSalonStaffSupport && !canUse(ctx, 'support_tickets') && !(await isPlatformAdmin(ctx, cid))) {
      return send(ctx, cid, t(lg, 'feature_support_unavailable'));
    }
    await setState(ctx, cid, { step: STEP.SUPPORT_MSG });
    return send(ctx, cid, t(lg, 'support_enter_msg'), { reply_markup: { inline_keyboard: [[{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]] } });
  }

  if (d === CB.TECH_SUPPORT_REQ) {
    const role = await getRole(ctx, cid);
    if (role !== 'master' && role !== 'tenant_owner' && role !== 'system_admin') return;
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
    const clientCid = safeParseInt(d.slice(CB.TICKET_DECLINE.length));
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
    if (suffix.startsWith('tk_') && ctx.db) {
      const role = await getRole(ctx, cid);
      if (role !== 'support' && role !== 'technical_support' && role !== 'tenant_owner' && role !== 'system_admin') return;
      const result = await claimTicket(ctx, suffix, cid);
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
    const clientCid = safeParseInt(suffix);
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
    const clientCid = safeParseInt(d.slice(CB.TICKET_FREE_CORRECTION.length));
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
    const clientCid = safeParseInt(d.slice(CB.TICKET_CLOSE.length));
    if (!clientCid) return;
    const ticket = await getTicket(ctx, clientCid);
    const closeRole = await getRole(ctx, cid);
    if (!ticket || (ticket.masterCid !== cid && !(await isAdmin(ctx, cid)) && closeRole !== 'technical_support' && closeRole !== 'system_admin')) return;
    // Also close the global platform ticket if linked
    if (ticket.globalTicketId && ctx.db) {
      try { await closeTicket(ctx, ticket.globalTicketId); } catch (_) {}
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
    if (!agentChatId || !ctx.db) return showPlatformSupportList(ctx, cid);
    await removeSupport(ctx, agentChatId);
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
    if (!agentChatId || !ctx.db) return showPlatformTechSupportList(ctx, cid);
    await removeTechnicalSupport(ctx, agentChatId);
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
    const agentChatId = safeParseInt(d.slice(CB.ADM_SUPPORT_REMOVE.length).trim());
    if (!Number.isFinite(agentChatId) || agentChatId <= 0 || !ctx.kv) return showTenantSupportList(ctx, cid);
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

  if (d === CB.ADM_CALENDAR) {
    if (!await isAdmin(ctx, cid)) return;
    if (!canUse(ctx, 'calendar')) return send(ctx, cid, t(lg, 'feature_calendar_unavailable'));
    return showGoogleCalendarPanel(ctx, cid, lg, { scope: 'tenant', backCb: CB.ADM_SETTINGS });
  }

  if (d === CB.ADM_CALENDAR_RESYNC) {
    if (!await isAdmin(ctx, cid)) return;
    if (!canUse(ctx, 'calendar')) return send(ctx, cid, t(lg, 'feature_calendar_unavailable'));
    try {
      const result = await syncGoogleIntegrationNow(ctx, { scope: 'tenant' });
      const notice = result.ok
        ? `✅ Sync complete: ${result.result?.blocks ?? 0} busy events cached.`
        : '❌ Google Calendar is not connected yet.';
      return showGoogleCalendarPanel(ctx, cid, lg, { scope: 'tenant', backCb: CB.ADM_SETTINGS, notice });
    } catch (e) {
      return showGoogleCalendarPanel(ctx, cid, lg, {
        scope: 'tenant',
        backCb: CB.ADM_SETTINGS,
        notice: `❌ Sync failed: ${escHtml(e.message)}`,
      });
    }
  }

  if (d === CB.ADM_CALENDAR_CLEAR) {
    if (!await isAdmin(ctx, cid)) return;
    const removed = await revokeGoogleIntegration(ctx, { scope: 'tenant' });
    return showGoogleCalendarPanel(ctx, cid, lg, {
      scope: 'tenant',
      backCb: CB.ADM_SETTINGS,
      notice: removed ? t(lg, 'mst_calendar_cleared') : 'ℹ️ Google Calendar was not connected.',
    });
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
    // system_admin without explicit tenant role still gets the admin panel
    if (await isPlatformAdmin(ctx, cid)) return showAdminPanel(ctx, cid, name);
    return;
  }

  if (d === CB.ADM_BILLING) {
    if (!await isAdmin(ctx, cid)) return;
    if (!ctx.tenantId || !ctx.db) return send(ctx, cid, t(lg, 'billing_no_config'));
    return showBillingMenu(ctx, cid);
  }

  if (d === CB.ADM_META_CHANNELS) {
    if (!await isAdmin(ctx, cid)) return;
    if (!ctx.tenantId) return;
    if (!canUse(ctx, 'whatsapp') && !canUse(ctx, 'instagram')) {
      return send(ctx, cid, t(lg, 'adm_meta_channels_plan'));
    }
    return showMetaChannelsGuide(ctx, cid);
  }

  if (d.startsWith(CB.BILLING_SUBSCRIBE)) {
    if (!await isAdmin(ctx, cid)) return;
    if (!ctx.tenantId || !ctx.db) return send(ctx, cid, t(lg, 'billing_no_config'));
    const plan = d.slice(CB.BILLING_SUBSCRIBE.length);
    const baseUrl = ctx.baseUrl || '';
    const tenant = await getTenant(ctx, ctx.tenantId);
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
      return showBillingMenu(ctx, cid);
    }
    return send(ctx, cid, t(lg, 'billing_no_config'));
  }

  if (d === CB.BILLING_PORTAL) {
    if (!await isAdmin(ctx, cid)) return;
    if (!ctx.tenantId || !ctx.db) return send(ctx, cid, t(lg, 'billing_no_config'));
    const tenant = await getTenant(ctx, ctx.tenantId);
    if (!tenant?.stripeCustomerId) return send(ctx, cid, t(lg, 'billing_no_config'));
    const baseUrl = ctx.baseUrl || '';
    const result = await createPortalSession(ctx, {
      customerId: tenant.stripeCustomerId,
      returnUrl: baseUrl ? `${baseUrl}/` : undefined,
    });
    if (result.error) return send(ctx, cid, t(lg, 'billing_no_config') + '\n' + result.error);
    if (result.url) {
      await send(ctx, cid, t(lg, 'billing_portal_sent') + '\n\n' + result.url);
      return showBillingMenu(ctx, cid);
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
    const mId = safeParseInt(d.slice(CB.ADM_RENAME_M.length));
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
    const mId = safeParseInt(d.slice(CB.ADM_DEL_M.length));
    if (mId) await deleteMaster(ctx, mId);
    await send(ctx, cid, t(lg, 'adm_master_removed'));
    return showMastersList(ctx, cid);
  }

  if (d.startsWith(CB.ADM_VACATION)) {
    if (!await isAdmin(ctx, cid)) return;
    const mId = safeParseInt(d.slice(CB.ADM_VACATION.length));
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
    const apt = await getAptById(ctx, aptId);
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
    const masterId = safeParseInt(parts[1]);
    if (!aptId || !masterId) return;
    const apt = await getAptById(ctx, aptId);
    if (!apt || apt.cx) return;
    const master = await getMaster(ctx, masterId);
    if (!master) return;
    apt.masterId = masterId;
    await updateApt(ctx, aptId, { masterId });
    // Re-sync calendar if the appointment is already confirmed (master changed → move event)
    if (apt.status === 'confirmed' && canUse(ctx, 'calendar')) {
      syncAppointmentCalendar(ctx, apt).catch(e => log.error('handlers.callback', e instanceof Error ? e : new Error(String(e.message)), { action: 'gcal_re_sync' }));
    }
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
    const masterId = safeParseInt(d.slice(CB.ADM_ALL_APTS_M.length));
    return showAdminAllApts(ctx, cid, masterId || null);
  }

  if (d === CB.ADM_CLIENTS) {
    if (!await isAdmin(ctx, cid)) return;
    return showClientsList(ctx, cid, 0);
  }

  if (d.startsWith(CB.ADM_CLIENTS_PAGE)) {
    if (!await isAdmin(ctx, cid)) return;
    const page = safeParseInt(d.slice(CB.ADM_CLIENTS_PAGE.length), 0);
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
    const idx = safeParseInt(d.slice(CB.ADM_ABOUT_PHOTO_DEL.length), -1);
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
    const targetId = safeParseInt(d.slice(CB.ADM_BLOCK.length));
    if (targetId) await blockUser(ctx, targetId);
    await send(ctx, cid, t(lg, 'adm_blocked'));
    return showClientsList(ctx, cid);
  }

  if (d.startsWith(CB.ADM_UNBLOCK)) {
    if (!await isAdmin(ctx, cid)) return;
    const targetId = safeParseInt(d.slice(CB.ADM_UNBLOCK.length));
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
    const apt = await getAptById(ctx, aptId);
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
    const apt = await getAptById(ctx, aptId);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    apt.status = 'confirmed';
    apt.confirmedBy = cid;
    if (!apt.masterId) apt.masterId = cid;
    await updateApt(ctx, aptId, { status: 'confirmed', confirmedBy: cid, masterId: apt.masterId });
    await sendAptConfirmedToClient(ctx, apt);
    if (canUse(ctx, 'calendar')) {
      try {
        await syncAppointmentCalendar(ctx, apt);
      } catch (e) {
        log.error('handlers.callback', e instanceof Error ? e : new Error(String(e.message)), { action: 'calendar_sync' });
      }
    }
    return send(ctx, cid, fill(t(lg, 'mst_apt_confirmed'), { client: escHtml(apt.userName), dt: fmtDT(lg, apt.date, apt.time) }));
  }

  if (d.startsWith(CB.APT_REJECT) && !d.startsWith(CB.APT_REJECT_SKIP)) {
    if (!await canManageApt(ctx, cid)) return;
    const aptId = d.slice(CB.APT_REJECT.length);
    const apt = await getAptById(ctx, aptId);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    await setState(ctx, cid, { step: STEP.REJECT_COMMENT, aptId });
    return send(ctx, cid, t(lg, 'mst_reject_prompt'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'mst_skip'), callback_data: CB.APT_REJECT_SKIP + aptId }],
    ]}});
  }

  if (d.startsWith(CB.APT_REJECT_SKIP)) {
    if (!await canManageApt(ctx, cid)) return;
    const aptId = d.slice(CB.APT_REJECT_SKIP.length);
    const apt = await getAptById(ctx, aptId);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    apt.status = 'rejected';
    await updateApt(ctx, aptId, { status: 'rejected' });
    if (apt.googleEventId) {
      await deleteAppointmentCalendar(ctx, apt).catch(e => log.error('handlers.callback', e instanceof Error ? e : new Error(String(e.message)), { action: 'reject_calendar_delete' }));
    }
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
    const apt = await getAptById(ctx, aptId);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    await setState(ctx, cid, { step: STEP.COUNTER_TIME, aptId });
    return send(ctx, cid, t(lg, 'mst_counter_time'));
  }

  if (d.startsWith(CB.APT_COUNTER_SKIP)) {
    if (!await canManageApt(ctx, cid)) return;
    const aptId = d.slice(CB.APT_COUNTER_SKIP.length);
    const st = await getState(ctx, cid);
    if (st.step !== STEP.COUNTER_COMMENT || st.aptId !== aptId) return;
    const apt = await getAptById(ctx, aptId);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    apt.status = 'counter_offer';
    apt.counterTime = st.newTime;
    apt.counterComment = null;
    apt.confirmedBy = cid;
    await updateApt(ctx, aptId, { status: 'counter_offer', counterTime: st.newTime, counterComment: null, confirmedBy: cid });
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
    const apt = await getAptById(ctx, aptId);
    if (!apt || apt.status !== 'counter_offer' || apt.chatId !== cid) return;
    const newTime = apt.counterTime;
    apt.time = newTime;
    const [y, mo, dd] = apt.date.split('-').map(Number);
    const [h, mi] = newTime.split(':').map(Number);
    apt.ts = warsawToUTC(y, mo, dd, h, mi).getTime();
    apt.status = 'confirmed';
    if (!apt.masterId && apt.confirmedBy) apt.masterId = apt.confirmedBy;
    await updateApt(ctx, aptId, { status: 'confirmed', time: newTime, ts: apt.ts, masterId: apt.masterId });
    await sendAptConfirmedToClient(ctx, apt);
    if (canUse(ctx, 'calendar')) {
      try {
        await syncAppointmentCalendar(ctx, apt);
      } catch (e) {
        log.error('handlers.callback', e instanceof Error ? e : new Error(String(e.message)), { action: 'counter_offer_calendar_sync' });
      }
    }
    if (apt.confirmedBy) {
      const mlg = await getLang(ctx, apt.confirmedBy) || 'ru';
      await send(ctx, apt.confirmedBy, fill(t(mlg, 'mst_client_accepted'), { client: escHtml(apt.userName), newtime: newTime }));
    }
    return;
  }

  if (d.startsWith(CB.APT_DECLINE)) {
    const aptId = d.slice(CB.APT_DECLINE.length);
    const apt = await getAptById(ctx, aptId);
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
    const apt = await getAptById(ctx, aptId);
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
    const idx = safeParseInt(parts[1], -1);
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
    return showGoogleCalendarPanel(ctx, cid, lg, { scope: 'master', masterChatId: cid, backCb: CB.MST_MAIN });
  }

  if (d === CB.MST_CALENDAR_RESYNC) {
    if (!await isMaster(ctx, cid) && !await isAdmin(ctx, cid)) return;
    if (!canUse(ctx, 'calendar')) return send(ctx, cid, t(lg, 'feature_calendar_unavailable'));
    try {
      const result = await syncGoogleIntegrationNow(ctx, { scope: 'master', masterChatId: cid });
      const notice = result.ok
        ? `✅ Sync complete: ${result.result?.blocks ?? 0} busy events cached.`
        : '❌ Google Calendar is not connected yet.';
      return showGoogleCalendarPanel(ctx, cid, lg, {
        scope: 'master',
        masterChatId: cid,
        backCb: CB.MST_MAIN,
        notice,
      });
    } catch (e) {
      return showGoogleCalendarPanel(ctx, cid, lg, {
        scope: 'master',
        masterChatId: cid,
        backCb: CB.MST_MAIN,
        notice: `❌ Sync failed: ${escHtml(e.message)}`,
      });
    }
  }

  if (d === CB.MST_CALENDAR_SET) {
    if (!await isMaster(ctx, cid) && !await isAdmin(ctx, cid)) return;
    if (!canUse(ctx, 'calendar')) return send(ctx, cid, t(lg, 'feature_calendar_unavailable'));
    if (!ctx.GOOGLE_SERVICE_ACCOUNT_KEY) {
      return showGoogleCalendarPanel(ctx, cid, lg, {
        scope: 'master',
        masterChatId: cid,
        backCb: CB.MST_MAIN,
        notice: 'ℹ️ Manual Calendar ID mode requires GOOGLE_SERVICE_ACCOUNT_KEY.',
      });
    }
    await setState(ctx, cid, { step: STEP.SET_CALENDAR_ID });
    return send(ctx, cid, t(lg, 'mst_calendar_enter_id'), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.MST_CALENDAR }]] },
    });
  }

  if (d === CB.MST_CALENDAR_CLEAR) {
    if (!await isMaster(ctx, cid) && !await isAdmin(ctx, cid)) return;
    await revokeGoogleIntegration(ctx, { scope: 'master', masterChatId: cid }).catch(() => false);
    const master = await getMaster(ctx, cid) || {};
    await saveMaster(ctx, cid, { ...master, googleCalendarId: null, calendarEnabled: false });
    return showGoogleCalendarPanel(ctx, cid, lg, {
      scope: 'master',
      masterChatId: cid,
      backCb: CB.MST_MAIN,
      notice: t(lg, 'mst_calendar_cleared'),
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
    st.tosAcceptedAt = Math.floor(Date.now() / 1000);
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

  // ── Review rating flow ──────────────────────────────────────────────────
  if (d.startsWith('rev:')) {
    const parts = d.split(':');
    const aptId = parts[1];
    const rating = safeParseInt(parts[2], 0);
    if (!aptId || rating < 1 || rating > 5) return;
    const existing = await getReviewByApt(ctx, aptId);
    if (existing) return send(ctx, cid, t(lg, 'review_already'));
    const apt = await getAptById(ctx, aptId);
    if (!apt || String(apt.chat_id || apt.chatId) !== String(cid)) return;
    const reviewId = await createReview(ctx, { aptId, chatId: cid, masterId: apt.master_id || apt.masterId, rating });
    await answerCb(ctx, cb.id, `${rating}⭐`);
    return send(ctx, cid, fill(t(lg, 'review_thanks'), { rating }), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'review_add_comment'), callback_data: `revc:${reviewId}` }],
      [{ text: t(lg, 'review_skip_comment'), callback_data: `revd:${reviewId}` }],
    ] } });
  }

  // Review: user wants to add comment
  if (d.startsWith('revc:')) {
    const reviewId = d.slice(5);
    await setState(ctx, cid, { step: 'review_text', reviewId });
    return send(ctx, cid, t(lg, 'review_enter_text'));
  }

  // Review: skip comment, ask for photo
  if (d.startsWith('revd:')) {
    const reviewId = d.slice(5);
    const { getConfig } = await import('../services/services.js');
    const photosEnabled = await getConfig(ctx, 'reviews_photos');
    if (photosEnabled !== false) {
      return send(ctx, cid, t(lg, 'review_text_saved'), { reply_markup: { inline_keyboard: [
        [{ text: t(lg, 'review_add_photo'), callback_data: `revp:${reviewId}` }],
        [{ text: t(lg, 'review_done'), callback_data: `revf:${reviewId}` }],
      ] } });
    }
    const rev = await getReviewById(ctx, reviewId);
    const msg = rev?.text
      ? fill(t(lg, 'review_complete'), { rating: rev.rating, text: rev.text })
      : fill(t(lg, 'review_complete_no_text'), { rating: rev.rating });
    return send(ctx, cid, msg);
  }

  // Review: user wants to add photos
  if (d.startsWith('revp:')) {
    const reviewId = d.slice(5);
    const rev = await getReviewById(ctx, reviewId);
    const photos = rev?.photos ? JSON.parse(rev.photos) : [];
    const remaining = 3 - photos.length;
    if (remaining <= 0) {
      const msg = rev?.text
        ? fill(t(lg, 'review_complete'), { rating: rev.rating, text: rev.text })
        : fill(t(lg, 'review_complete_no_text'), { rating: rev.rating });
      return send(ctx, cid, msg);
    }
    await setState(ctx, cid, { step: 'review_photo', reviewId });
    return send(ctx, cid, fill(t(lg, 'review_send_photo'), { n: remaining }));
  }

  // Review: finalize
  if (d.startsWith('revf:')) {
    const reviewId = d.slice(5);
    const rev = await getReviewById(ctx, reviewId);
    await clearState(ctx, cid);
    const msg = rev?.text
      ? fill(t(lg, 'review_complete'), { rating: rev.rating, text: rev.text })
      : fill(t(lg, 'review_complete_no_text'), { rating: rev.rating });
    return send(ctx, cid, msg);
  }

  if (d === CB.ABOUT)    return showAbout(ctx, cid);
  if (d === CB.CATALOG)  return showCatalog(ctx, cid);

  if (d.startsWith(CB.CAT_PHOTO)) {
    const parts = d.slice(CB.CAT_PHOTO.length).split(':');
    const svcId = parts[0];
    if (!ctx.svcIds.has(svcId)) return;
    const idx = Math.max(0, safeParseInt(parts[1], 0));
    return showCatPhoto(ctx, cid, svcId, idx, mid);
  }

  if (d.startsWith(CB.ABOUT_PHOTO)) {
    const idx = Math.max(0, safeParseInt(d.slice(CB.ABOUT_PHOTO.length), 0));
    return showAbout(ctx, cid, idx, mid);
  }

  if (d.startsWith(CB.SERVICE)) {
    const sid = d.slice(CB.SERVICE.length);
    if (!ctx.svcIds.has(sid)) return;
    const s = ctx.svc.find(x => x.id === sid);
    const user = await getUser(ctx, cid);
    if (!isRegComplete(user)) {
      return startBooking(ctx, cid, cb.from);
    }
    const st0 = await getState(ctx, cid);
    if (st0.step === STEP.BOOK_ADJUST && st0.date && st0.time) {
      return startBookingWithService(ctx, cid, cb.from, sid, st0.date, st0.time, st0.masterId ?? null);
    }
    await setState(ctx, cid, { step: STEP.DATE, svcId: sid });
    const chosenText = isCorrectionSvc(sid)
      ? fill(t(lg, 'chosen_correction'), { svc: svcName(ctx, lg, sid) }) + '\n\n' + t(lg, 'choose_date')
      : fill(t(lg, 'chosen'), { svc: svcName(ctx, lg, sid), p: String(s.price), c: t(lg, 'cur'), d: String(s.dur), min: t(lg, 'min') }) + '\n\n' + t(lg, 'choose_date');
    await send(ctx, cid, chosenText, calKb(lg, 0));
    return;
  }

  if (d.startsWith(CB.CAL_MONTH)) {
    const off = Math.max(0, Math.min(2, safeParseInt(d.slice(CB.CAL_MONTH.length), 0)));
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

  // Instagram: service list page navigation
  if (d.startsWith(CB.SVC_PAGE)) {
    const page = Math.max(0, safeParseInt(d.slice(CB.SVC_PAGE.length), 0));
    return edit(ctx, cid, mid, t(lg, 'choose_svc'), svcKb(ctx, lg, page));
  }

  // Instagram: master list page navigation
  if (d.startsWith(CB.MASTER_PAGE)) {
    const page = Math.max(0, safeParseInt(d.slice(CB.MASTER_PAGE.length), 0));
    const st = await getState(ctx, cid);
    if (!st.svcId || !st.date) return;
    await showMasterPick(ctx, cid, st.svcId, st.date, st, page);
    return;
  }

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
    const masterId = safeParseInt(d.slice(CB.MASTER_SEL.length));
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

    // Secondary contact gate: even if startBookingWithService didn't catch
    // an incomplete user (race / direct callback / legacy state), refuse to
    // create an appointment without a real name + phone. Re-route to the
    // registration flow preserving the booking selection.
    const preCheckUser = await getUser(ctx, cid);
    if (!isRegComplete(preCheckUser)) {
      const isWeb = ctx.channel?.type === 'web';
      await setState(ctx, cid, {
        step: isWeb ? STEP.REG_NAME : STEP.REG_CONFIRM,
        flow: 'book',
        svcId: st.svcId,
        date: st.date,
        time: st.time,
        masterId: st.masterId || null,
        tgName: isWeb ? null : ([cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(' ') || '?'),
        tgUser: cb.from?.username || null,
        tgLang: cb.from?.language_code || null,
      });
      if (isWeb) {
        return send(ctx, cid, t(lg, 'reg_enter_name'));
      }
      const tgName = [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(' ') || '?';
      return send(ctx, cid, fill(t(lg, 'reg_confirm_name'), { n: escHtml(tgName) }), {
        reply_markup: { inline_keyboard: [
          [{ text: t(lg, 'reg_yes'), callback_data: CB.REG_YES }],
          [{ text: t(lg, 'reg_change'), callback_data: CB.REG_CHANGE }],
        ] },
      });
    }

    const lockKey = `lock:slot:${st.date}:${st.time}:${st.masterId ?? 'any'}`;
    const lockTaken = await kvGet(ctx, lockKey);
    if (lockTaken) {
      const fallbackSlots = await getSlots(ctx, st.date, st.svcId, st.masterId ?? null);
      if (fallbackSlots.length) {
        return send(ctx, cid, t(lg, 'slot_taken'), timeKb(fallbackSlots, lg));
      }
      return send(ctx, cid, fill(t(lg, 'no_slots'), { d: fmtDate(lg, st.date) }), calKb(lg, 0));
    }
    await kvPut(ctx, lockKey, 1, { expirationTtl: LOCK_TTL_SEC });

    const slots = await getSlots(ctx, st.date, st.svcId, st.masterId ?? null);
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

    if (apt === SLOT_TAKEN) {
      // Lost the race: the partial UNIQUE index (migration 0044) rejected our
      // INSERT because another isolate booked this slot first. Re-render the
      // current free slots so the user can pick a different time.
      const fresh = await getSlots(ctx, st.date, st.svcId, st.masterId ?? null);
      if (fresh.length) return send(ctx, cid, t(lg, 'slot_taken'), timeKb(fresh, lg));
      return send(ctx, cid, fill(t(lg, 'no_slots'), { d: fmtDate(lg, st.date) }), calKb(lg, 0));
    }
    if (!apt) {
      return send(ctx, cid, fill(t(lg, 'book_limit'), { n: String(MAX_APTS) }), mainKb(lg));
    }

    // Per-channel auto-confirm: web defaults ON, others default OFF.
    // When ON we promote the appointment straight to `confirmed` and tell
    // the client. The master still receives an info-only notification so
    // they're aware (without Accept/Reject buttons since there's nothing
    // to decide).
    const channelType = ctx.channel?.type || 'telegram';
    const autoConfirm = await getAutoConfirm(ctx, channelType);
    if (autoConfirm) {
      await updateApt(ctx, apt.id, { status: 'confirmed', confirmedBy: 'auto' });
      apt.status = 'confirmed';
      apt.confirmedBy = 'auto';
      await sendAptConfirmedToClient(ctx, apt);
      await notifyAptStaffAutoConfirmed(ctx, apt, user);
      // Best-effort calendar sync — same pattern as the master-confirm path.
      if (canUse(ctx, 'calendar')) {
        try {
          await syncAppointmentCalendar(ctx, apt);
        } catch (e) {
          log.error('handlers.callback', e instanceof Error ? e : new Error(String(e?.message)), { action: 'auto_confirm_calendar_sync' });
        }
      }
      return;
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
    const st = await getState(ctx, cid);
    if (st.step === STEP.CONFIRM && st.svcId && st.date && st.time) {
      return enterBookingAdjustState(ctx, cid, st);
    }
    await clearState(ctx, cid);
    return send(ctx, cid, t(lg, 'book_cancelled'), mainKb(lg));
  }

  if (d.startsWith(CB.CANCEL_APT_YES)) {
    const aptId = d.slice(CB.CANCEL_APT_YES.length);
    const apt = await getAptById(ctx, aptId);
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
    const apt = await getAptById(ctx, aptId);
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
