import { CB, STEP } from '../config.js';
import { nowSec } from '../utils/time.js';
import { isInactive, canUse, getMastersLimit } from '../billing/features.js';
import { showInactiveMessage } from '../ui/billing.js';
import { escHtml, fill, t, svcName, isValidChatId, detectLang, instagramAiTriggerAllows } from '../utils/helpers.js';
import { isValidDate, isValidTime, fmtDate, fmtDT, resolveDateHint, resolveTimeHint, dateStrForOffset } from '../utils/date.js';
import { kvGet, kvPut } from '../utils/kv.js';
import { ticketFwdAckKey } from '../utils/kv-keys.js';
import { send, api } from '../telegram.js';
import { getState, setState, clearState, checkRateLimit } from '../services/state.js';
import { getLang, setLang, getChatHistory, appendChatTurn, clearChatHistory } from '../services/chat.js';
import { getUser, saveUser, getRole, isAdmin, isMaster, isBlocked, canManageApt, getAdminId, setAdminId, getMaster, saveMaster, listMasters, resolveMasterInput, blockUser, unblockUser, upsertUserFromTelegram, isPlatformAdmin } from '../services/users.js';
import { saveServices, loadAboutPhotos, saveAboutPhotos, loadAboutDesc, saveAboutDesc, loadInstagramUrl, saveInstagramUrl } from '../services/services.js';
import { cancelApt, getApts, getAptById, updateApt } from '../services/appointments.js';
import { getTicket, setTicket, setTicketMaster, clearTicket, getTicketMaster, isTicketCloseWord, incHumanRequestCount } from '../services/tickets.js';
import { decodeStartPayload, recordOrigin } from '../services/origins.js';
import { logEvent } from '../utils/events.js';
import { createTicket, appendTicketMessage } from '../support/tickets.js';
import { setTenantRole, ROLES, getTechnicalSupportAgents, getTenantSupportAgents, addTenantSupportAgent } from '../roles/roles.js';
import { addSupport, removeSupport, createTenant, registerBot, setSystemAdmin, addTechnicalSupport } from '../admin/provisioning.js';
import { getTenant, putTenant, listTenantIds, getBotIdsByTenantId, getBot, getBotToken } from '../tenant/storage.js';
import { showPlatformAdminPanel, showPlatformSupportList, showPlatformTechSupportList } from '../ui/sysadmin.js';
import { timingSafeEqual, randomId } from '../utils/security.js';
import { confirmAllPendingApts, notifyStaffAptCancelled } from '../notifications.js';
import { audit } from '../utils/audit.js';
import { deleteAppointmentCalendar } from '../services/google-calendar-oauth.js';
import { mainKb, svcKb } from '../ui/keyboards.js';
import { showWelcome, showHomeByRole, showPrices, showContacts, showCatalog, showMyApts, showLangPick, showReviews, showAbout } from '../ui/screens.js';
import { showAdminPanel, showMasterPanel, showServiceEdit, showServicesList, showServicePhotos, showAboutSettings, showAboutPhotos, showAboutDescEdit, showAboutInstagramEdit, showMastersList, showAdminCancelAllConfirm, showAdminSettings, showTenantSupportList } from '../ui/admin.js';
import { startBooking, startBookingWithService, showCancelAllConfirm, enterBookingAdjustState } from '../ui/booking.js';
import { runWorkersAI, parseAIActions, executeAIAction, validateActionParams } from '../ai.js';
import { isWantHumanMessage, isMyAppointmentsMessage, getContextAction, parseQuickBookingPhrase, hasHeavyProfanity, isConfirmAllRequestsMessage, isAdminCancelAllMessage, isBookingConfirmDeclineText, parseServiceMention } from '../patterns.js';
// timingSafeEqual imported above from security.js

// ─── SECURITY: privileged commands forbidden on the web channel ──────────────
// Web sessions are public — anyone with the link can open one — so they must
// never be able to invoke admin/master/system commands, even if a stale role
// row matches their hashed chat_id. The role lockdown in `getRole` /
// `resolveRole` covers the runtime check; this set drops the commands at
// the entry point so they don't even reach the role-aware handlers.
const BLOCKED_WEB_COMMANDS = new Set([
  '/admin',
  '/sysadmin',
  '/panel',
  '/master',
  '/client',
  '/resetwebhooks',
  '/migrate',
  '/seed',
  '/provision',
  '/setup',
  '/debug',
  '/dump',
  '/export',
]);
const BLOCKED_WEB_COMMAND_PREFIXES = [
  '/grant_',
  '/add_',
  '/remove_',
  '/sysadm_',
  '/admin_',
  '/become_',
];

async function showHelp(ctx, cid, lg, realRole) {
  let text;
  if (realRole === 'system_admin') {
    text = [
      '🌐 <b>God Mode — Полный список команд платформы</b>',
      '',
      '<b>🔧 Системное управление:</b>',
      '/start — Панель платформы ManicBot',
      '/panel — Открыть панель управления (адаптируется к роли)',
      `/sysadmin &lt;ключ&gt; — Зарегистрироваться как системный администратор`,
      '  <i>Пример: /sysadmin YOUR_SECRET_KEY</i>',
      '/resetwebhooks — ⚠️ Сбросить вебхуки ВСЕХ ботов платформы',
      '',
      '<b>👑 Управление ролями:</b>',
      '/grant_master @username [salonId] — Назначить мастера',
      '  <i>Пример: /grant_master @ivan t_salon1</i>',
      '/grant_salon @username [salonId] — Назначить владельца салона',
      '  <i>Пример: /grant_salon @owner t_salon2</i>',
      '/admin &lt;ключ&gt; — Стать администратором тенанта (в боте салона)',
      '  <i>Пример: /admin YOUR_SECRET_KEY</i>',
      '',
      '<b>🆘 Агенты поддержки:</b>',
      '/add_support @username — Добавить агента поддержки клиентов',
      '  <i>Пример: /add_support @maria_support</i>',
      '/remove_support @username — Удалить агента поддержки',
      '  <i>Пример: /remove_support 321706035</i>',
      '/add_technical_support @username — Добавить агента техподдержки',
      '  <i>Пример: /add_technical_support @tech_guy</i>',
      '/support_register &lt;ключ&gt; — Самозапись как агент поддержки',
      '  <i>Пример: /support_register YOUR_SECRET_KEY</i>',
      '',
      '<b>🧭 Навигация:</b>',
      '/master — Открыть панель мастера',
      '/client — Переключиться в режим клиента (без прав)',
      '/book, /my, /prices, /catalog, /contacts, /lang — стандартные команды',
      '',
      '<b>🤖 AI распознаёт (пиши в чат):</b>',
      '• «Список салонов» / «Создать салон»',
      '• «Агенты поддержки» / «Техподдержка»',
      '• «Биллинг» / «Ссылки на панели»',
    ].join('\n');
  } else if (realRole === 'admin' || realRole === 'tenant_owner') {
    text = [
      '📋 <b>Помощь — Администратор</b>',
      '',
      '<b>Навигация:</b>',
      '/start — Открыть панель администратора',
      '/panel — Панель управления (адаптируется к роли)',
      '/master — Панель мастера',
      '/client — Режим просмотра клиента',
      '',
      '<b>Управление командой:</b>',
      '/add_support @username — Добавить агента поддержки',
      '  <i>Пример: /add_support @maria</i>',
      '/remove_support @username — Удалить агента поддержки',
      '  <i>Пример: /remove_support @maria</i>',
      '/grant_master @username — Назначить мастера',
      '  <i>Пример: /grant_master @ivan_master</i>',
      '/support_register &lt;ключ&gt; — Регистрация агента (с ключом)',
      '',
      '<b>Клиентские команды:</b>',
      '/book — Записать клиента / себя',
      '/my — Мои записи',
      '/prices — Прайс-лист',
      '/catalog — Каталог работ',
      '/contacts — Контакты',
      '/lang — Язык интерфейса',
      '',
      '<b>🤖 AI понимает:</b>',
      '• «Все записи» / «Записи на сегодня» / «На завтра»',
      '• «Список клиентов» / «Список мастеров»',
      '• «Список услуг» / «Биллинг» / «Открой панель»',
      '',
      '<b>📱 Instagram / WhatsApp (тариф Pro+):</b>',
      'Кнопка в панели админа или меню «Салон» → Mini App → вкладка Channels.',
    ].join('\n');
  } else if (realRole === 'master') {
    text = [
      '📋 <b>Помощь — Мастер</b>',
      '',
      '<b>Основные команды:</b>',
      '/start — Главное меню / панель мастера',
      '/my — Расписание и записи',
      '/book — Записать клиента',
      '/prices — Прайс-лист',
      '/catalog — Каталог работ',
      '/contacts — Контакты салона',
      '/lang — Язык интерфейса',
      '',
      '<b>Панель мастера:</b>',
      '/master — Открыть панель мастера',
      '/panel — Панель (адаптируется к роли)',
      '/client — Режим просмотра клиента',
      '',
      '<b>🤖 AI понимает:</b>',
      '• «Мои записи на завтра» / «Расписание»',
      '• «Открой мой календарь» / «Отзывы»',
      '• «Что сегодня?» / «Ближайшие записи»',
    ].join('\n');
  } else {
    text = fill(t(lg, 'help'), {});
  }
  return send(ctx, cid, text, { reply_markup: { remove_keyboard: true } });
}

async function handleAIChat(ctx, cid, txt, lg, realRole, from, opts = {}) {
  // Gate: AI plan check only for salon staff (master/admin) — clients & platform roles always have AI
  const isPlatformRole = realRole === 'system_admin' || realRole === 'support' || realRole === 'technical_support';
  const isSalonStaff = realRole === 'admin' || realRole === 'master' || realRole === 'tenant_owner';
  const isStaff = isPlatformRole || isSalonStaff;
  if (isSalonStaff && !canUse(ctx, 'ai')) {
    return send(ctx, cid, t(lg, 'feature_ai_unavailable'));
  }
  if (!ctx._cachedMasters && ctx.kv) {
    try { ctx._cachedMasters = await listMasters(ctx); } catch (_) { ctx._cachedMasters = []; }
  }
  const showConsultBtn = !isStaff && isWantHumanMessage(txt);
  if (ctx.kv && showConsultBtn) await incHumanRequestCount(ctx, cid);
  let extraConsult = showConsultBtn
    ? { reply_markup: { inline_keyboard: [[{ text: t(lg, 'consultant_btn'), callback_data: CB.CONSULT_REQ }]] } }
    : {};
  const consultHint = extraConsult.reply_markup ? '\n\n' + t(lg, 'consultant_btn_hint') : '';
  if (hasHeavyProfanity(txt)) {
    await send(ctx, cid, t(lg, 'consultant_constructive') + consultHint, extraConsult);
    return;
  }
  const txtTooShort = txt.length < 2;
  const history = txtTooShort ? [] : await getChatHistory(ctx, cid);
  const bookingAdjust = opts.bookingAdjust || null;
  const aiReply = txtTooShort ? null : await runWorkersAI(ctx, txt, lg, realRole, history, bookingAdjust);
  const { text: aiText, actions } = parseAIActions(aiReply);
  // ADM_CONFIRM_ALL and ADM_CANCEL_ALL are intentionally excluded: these are destructive
  // bulk operations that must only be triggered via explicit button clicks, never from
  // free-text AI interpretation (prevents accidental confirmations / "intelligent DTP").
  // ADM_CONFIRM_ALL and ADM_CANCEL_ALL intentionally excluded: destructive bulk operations
  // must only be triggered via explicit button clicks, never from free-text AI interpretation.
  const pageActions = [
    // Client actions
    'MY_APTS', 'PRICES', 'CATALOG', 'CONTACTS', 'REVIEWS', 'ABOUT', 'MAIN', 'BOOK', 'CANCEL_ALL',
    // Admin actions
    'ADM_PANEL', 'ADM_TODAY', 'ADM_TOMORROW', 'ADM_ALL_APTS', 'ADM_MASTERS', 'ADM_CLIENTS', 'ADM_SVC_LIST', 'BILLING',
    // Master actions
    'MST_PANEL', 'MST_TODAY', 'MST_TOMORROW', 'MST_CALENDAR',
    // Platform admin actions
    'SYSADM_PANEL', 'TENANT_LIST', 'SUPPORT_LIST', 'CREATE_TENANT', 'BOT_NEW',
  ];
  let didAction = false;
  for (const { tag, param } of actions) {
    if (pageActions.includes(tag) || (tag === 'BOOK' && param)) {
      if (!validateActionParams(tag, param)) {
        console.warn(`[ai] rejected invalid action params: [${tag}:${param}]`);
        continue;
      }
      const ran = await executeAIAction(ctx, cid, realRole, tag, param, from);
      if (ran) { didAction = true; break; }
    }
    if (tag === 'CONSULT' && !isStaff) {
      extraConsult = { reply_markup: { inline_keyboard: [[{ text: t(lg, 'consultant_btn'), callback_data: CB.CONSULT_REQ }]] } };
      if (ctx.kv) await incHumanRequestCount(ctx, cid);
    }
  }
  await appendChatTurn(ctx, cid, txt, aiText || (didAction ? '' : null));
  if (didAction) return;
  const finalHint = extraConsult.reply_markup ? '\n\n' + t(lg, 'consultant_btn_hint') : '';
  // Стафф получает кнопку «В меню» (нейтральная, не «Панель админа» — только в админ-разделах)
  if (isStaff) {
    const backCb = (realRole === 'system_admin' || realRole === 'support' || realRole === 'technical_support') ? CB.SYSADM_MAIN : (realRole === 'admin' || realRole === 'tenant_owner') ? CB.ADM_MAIN : CB.MST_MAIN;
    extraConsult = { reply_markup: { inline_keyboard: [[{ text: t(lg, 'back_m'), callback_data: backCb }]] } };
    // Короткое сообщение (< 2 символа) не уходило в AI — не показываем «AI недоступен»; при реальном сбое AI — отдельная фраза
    const toSendStaff = aiText ? escHtml(aiText) : (txtTooShort ? t(lg, 'ai_short_use_panel') : t(lg, 'ai_unavailable_use_panel'));
    await send(ctx, cid, toSendStaff, extraConsult);
    return;
  }
  const toSend = (aiText ? escHtml(aiText) : t(lg, 'unknown')) + finalHint;
  return send(ctx, cid, toSend, extraConsult);
}

export async function onMsg(ctx, msg) {
  if (!msg?.chat?.id || !msg?.from) return;
  if (msg.chat.type !== 'private') return;

  const cid = msg.chat.id;
  if (!isValidChatId(cid)) {
    console.warn('[onMsg] invalid chat id rejected:', { channel: ctx.channel?.type, type: typeof cid, value: String(cid).slice(0, 80), tenantId: ctx.tenantId });
    return;
  }
  if (ctx.channel?.type) {
    console.log('[onMsg] channel message accepted:', { channel: ctx.channel.type, cid: String(cid).slice(0, 20), tenantId: ctx.tenantId });
  }

  // ─── SECURITY: web channel is hard-locked to the client role ──────────────
  // Reject any privileged command before it reaches the role-aware handlers.
  // Even if a stale tenant_roles row matched the hashed session id, the role
  // resolver in users.js / roles.js refuses to escalate it; this guard adds
  // a second line of defence at the entry point so the commands cannot leak
  // existence of the admin key system, role grants, or panel routes.
  if (ctx.channel?.type === 'web') {
    const rawCmd = (msg.text || '').trim().split(/\s+/, 1)[0] || '';
    if (BLOCKED_WEB_COMMANDS.has(rawCmd) || BLOCKED_WEB_COMMAND_PREFIXES.some((p) => rawCmd.startsWith(p))) {
      console.warn('[web] SECURITY: blocked privileged command from web session', {
        cmd: rawCmd, cid: String(cid).slice(0, 20), tenantId: ctx.tenantId,
      });
      return; // silent drop — don't reveal the command exists
    }
  }

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

  // Inactive/canceled billing: block staff access, let clients through freely
  if (isInactive(ctx) && !(await isPlatformAdmin(ctx, cid))) {
    const role = await getRole(ctx, cid);
    if (role !== 'client') return showInactiveMessage(ctx, cid);
  }

  if (msg.contact && st.step === STEP.REG_PHONE) {
    const phone = String(msg.contact.phone_number || '').slice(0, 20);
    return finishPhone(ctx, cid, phone, st);
  }

  // WhatsApp: auto-complete phone registration (channelUserId IS the phone number)
  if (ctx.channel?.type === 'whatsapp' && st.step === STEP.REG_PHONE) {
    const waPhone = msg._inbound?.channelUserId;
    if (waPhone) return finishPhone(ctx, cid, String(waPhone).slice(0, 20), st);
  }

  const txt = (msg.text || '').trim().slice(0, 200);

  const menuLabels = [t(lg, 'm_book'), t(lg, 'm_cat'), t(lg, 'm_prices'), t(lg, 'm_my'), t(lg, 'back_m'), t(lg, 'm_rev'), t(lg, 'm_about'), t(lg, 'm_cont'), t(lg, 'm_lang'), t(lg, 'm_support'), t(lg, 'mst_panel'), t(lg, 'adm_management')];

  // ── Review: text comment ────────────────────────────────────────────────
  if (st.step === 'review_text' && txt) {
    const { updateReviewText, getReviewById } = await import('../services/reviews.js');
    const { getConfig } = await import('../services/services.js');
    await updateReviewText(ctx, st.reviewId, txt.slice(0, 1000));
    await clearState(ctx, cid);
    const photosEnabled = await getConfig(ctx, 'reviews_photos');
    if (photosEnabled !== false) {
      return send(ctx, cid, t(lg, 'review_text_saved'), { reply_markup: { inline_keyboard: [
        [{ text: t(lg, 'review_add_photo'), callback_data: `revp:${st.reviewId}` }],
        [{ text: t(lg, 'review_done'), callback_data: `revf:${st.reviewId}` }],
      ] } });
    }
    const rev = await getReviewById(ctx, st.reviewId);
    return send(ctx, cid, fill(t(lg, 'review_complete'), { rating: rev.rating, text: rev.text }));
  }

  // ── Review: photo upload ───────────────────────────────────────────────
  if (st.step === 'review_photo' && msg.photo?.length) {
    const { addReviewPhoto, getReviewById } = await import('../services/reviews.js');
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const added = await addReviewPhoto(ctx, st.reviewId, `telegram:file_id:${fileId}`);
    const rev = await getReviewById(ctx, st.reviewId);
    const photos = rev?.photos ? JSON.parse(rev.photos) : [];
    const remaining = 3 - photos.length;
    if (!added || remaining <= 0) {
      await clearState(ctx, cid);
      return send(ctx, cid, fill(rev?.text ? t(lg, 'review_complete') : t(lg, 'review_complete_no_text'), { rating: rev.rating, text: rev?.text || '' }));
    }
    return send(ctx, cid, fill(t(lg, 'review_photo_saved'), { count: photos.length }) + '\n' + fill(t(lg, 'review_send_photo'), { n: remaining }), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'review_done'), callback_data: `revf:${st.reviewId}` }]] },
    });
  }

  if (st.step === STEP.SUPPORT_MSG && txt) {
    const isCommand = txt.startsWith('/');
    const isMenuButton = menuLabels.includes(txt);
    if (isCommand || isMenuButton) {
      await clearState(ctx, cid);
    } else {
      await clearState(ctx, cid);
      // Route support message to THIS salon's tenant support agents (or fallback to masters + admin)
      if (ctx.kv) {
        await setTicket(ctx, cid, { open: true, masterCid: null, since: Date.now(), msg: txt.slice(0, 500) });
        const tenantAgents = await getTenantSupportAgents(ctx);
        const notice = `🆘 <b>Запрос поддержки</b>\n👤 ${escHtml(name)}\n\n${escHtml(txt).slice(0, 300)}`;
        const claimKb = { reply_markup: { inline_keyboard: [[{ text: t(lg, 'support_claim_btn'), callback_data: CB.TICKET_TAKE + cid }]] } };
        const recipients = new Set();
        if (tenantAgents.length > 0) {
          for (const agId of tenantAgents) recipients.add(agId);
        } else {
          const masters = await listMasters(ctx);
          const adminId = await getAdminId(ctx);
          for (const m of masters) if (m.chatId && !m.onVacation) recipients.add(m.chatId);
          if (adminId) recipients.add(adminId);
        }
        for (const rcid of recipients) {
          try { await send(ctx, rcid, notice, claimKb); } catch (_) {}
        }
        await send(ctx, cid, t(lg, 'support_local_created'), mainKb(lg, 'client'));
      } else {
        await send(ctx, cid, t(lg, 'unknown'), mainKb(lg));
      }
      return;
    }
  }

  if (st.step === STEP.TECH_SUPPORT_MSG) {
    const bodyRaw = (msg.text || msg.caption || '').trim().slice(0, 2000);
    let attachmentUrl = null;
    if (msg.photo && msg.photo.length > 0) {
      const f = msg.photo[msg.photo.length - 1].file_id;
      attachmentUrl = `telegram:file_id:${f}`;
    } else if (msg.document?.file_id) {
      attachmentUrl = `telegram:file_id:${msg.document.file_id}`;
    }
    const hasPayload = !!(bodyRaw || attachmentUrl);
    if (!hasPayload) {
      /* wait for text or media */
    } else {
      const isCommand = bodyRaw.startsWith('/');
      const isMenuButton = menuLabels.includes(bodyRaw);
      if (isCommand || isMenuButton) {
        await clearState(ctx, cid);
      } else {
        await clearState(ctx, cid);
        const senderRole = await getRole(ctx, cid);
        if (senderRole !== 'master' && senderRole !== 'admin' && senderRole !== 'tenant_owner' && senderRole !== 'system_admin') {
          return send(ctx, cid, t(lg, 'tech_support_only_staff'));
        }
        const agents = ctx.db ? await getTechnicalSupportAgents(ctx) : [];
        if (agents.length > 0 && ctx.db) {
          const salonName = ctx.tenant?.name || ctx.SALON_NAME || 'Salon';
          const botId = ctx.bot?.botId || ctx.botId || null;
          const ticketDoc = await createTicket(ctx, cid, name, botId, bodyRaw, attachmentUrl);
          if (ticketDoc) {
            await setTicket(ctx, cid, {
              open: true,
              masterCid: null,
              since: Date.now(),
              msg: bodyRaw.slice(0, 500),
              globalTicketId: ticketDoc.id,
            });
            const preview = escHtml(bodyRaw || (attachmentUrl ? '[файл]' : '')).slice(0, 500);
            const notice = fill(t(lg, 'tech_support_notify'), { salon: escHtml(salonName), name: escHtml(name), role: senderRole, msg: preview })
              + `\n\n<code>${ticketDoc.id}</code>`;
            const techClaimKb = { reply_markup: { inline_keyboard: [[{ text: t(lg, 'support_claim_btn'), callback_data: CB.TICKET_TAKE + ticketDoc.id }]] } };
            for (const agId of agents) {
              try { await send(ctx, agId, notice, techClaimKb); } catch (_) {}
            }
            return send(ctx, cid, t(lg, 'tech_support_created'));
          }
        }
        if (agents.length > 0) {
          const salonName = ctx.tenant?.name || ctx.SALON_NAME || 'Salon';
          await setTicket(ctx, cid, { open: true, masterCid: null, since: Date.now(), msg: bodyRaw.slice(0, 500) });
          const notice = fill(t(lg, 'tech_support_notify'), { salon: escHtml(salonName), name: escHtml(name), role: senderRole, msg: escHtml(bodyRaw).slice(0, 500) });
          const techClaimKb = { reply_markup: { inline_keyboard: [[{ text: t(lg, 'support_claim_btn'), callback_data: CB.TICKET_TAKE + cid }]] } };
          for (const agId of agents) {
            try { await send(ctx, agId, notice, techClaimKb); } catch (_) {}
          }
          return send(ctx, cid, t(lg, 'tech_support_created'));
        }
        return send(ctx, cid, t(lg, 'unknown'));
      }
    }
  }

  if (txt.startsWith('/support_register ')) {
    const key = txt.slice(17).trim();
    if (!timingSafeEqual(key, ctx.ADMIN_KEY)) return send(ctx, cid, t(lg, 'adm_wrong_key'));
    const role = await getRole(ctx, cid);
    if (role !== 'admin' && role !== 'system_admin') return send(ctx, cid, t(lg, 'support_only_admin'));
    if (ctx.db) {
      await addSupport(ctx, cid);
      return send(ctx, cid, t(lg, 'support_registered'));
    }
    return send(ctx, cid, t(lg, 'unknown'));
  }

  if (txt.startsWith('/add_support ')) {
    const role = await getRole(ctx, cid);
    if (role !== 'admin' && role !== 'system_admin') return send(ctx, cid, t(lg, 'support_only_admin'));
    const arg = txt.slice(13).trim();
    if (!arg) return send(ctx, cid, t(lg, 'support_add_usage'));
    if (!ctx.kv) return send(ctx, cid, t(lg, 'unknown'));
    const { masterId, masterName } = await resolveMasterInput(ctx, msg, arg);
    if (!masterId) return send(ctx, cid, t(lg, 'support_user_not_found'));
    const added = await addTenantSupportAgent(ctx, masterId);
    if (!added) return send(ctx, cid, t(lg, 'adm_support_limit'));
    return send(ctx, cid, fill(t(lg, 'adm_support_added'), { n: escHtml(masterName), id: String(masterId) }));
  }

  if (txt.startsWith('/add_technical_support ')) {
    const tsRole = await getRole(ctx, cid);
    if (tsRole !== 'system_admin') {
      if (ctx.tenantId) return showWelcome(ctx, cid, name);
      return send(ctx, cid, t(lg, 'sysadm_no_access'));
    }
    const arg = txt.slice(24).trim();
    if (!arg) return send(ctx, cid, '⚠️ Использование: /add_technical_support @username или ID');
    if (!ctx.db) return send(ctx, cid, t(lg, 'unknown'));
    const { masterId, masterName } = await resolveMasterInput(ctx, msg, arg);
    if (!masterId) return send(ctx, cid, t(lg, 'support_user_not_found'));
    await addTechnicalSupport(ctx, masterId);
    return send(ctx, cid, t(lg, 'sysadm_tech_support_added'));
  }

  if (txt === '/resetwebhooks') {
    if (!(await isPlatformAdmin(ctx, cid))) return send(ctx, cid, t(lg, 'sysadm_no_access'));
    if (!ctx.db || !ctx.baseUrl) return send(ctx, cid, '❌ DB или baseUrl недоступны');
    await send(ctx, cid, '🔄 Обновляю вебхуки для всех ботов...');
    let ok = 0, fail = 0;
    let report = '';
    try {
      const tenantIds = await listTenantIds(ctx);
      for (const tenantId of tenantIds) {
        const botIds = await getBotIdsByTenantId(ctx, tenantId);
        for (const botId of botIds) {
          const bot = await getBot(ctx, botId);
          const token = await getBotToken(ctx, botId, ctx.BOT_ENCRYPTION_KEY || null);
          if (!token) { fail++; report += `❌ ${botId}: нет токена\n`; continue; }
          const webhookSecret = bot?.webhookSecret || '';
          const wh = `${ctx.baseUrl}/webhook/${botId}`;
          try {
            const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: wh, secret_token: webhookSecret }),
            });
            const data = await r.json();
            if (data.ok) { ok++; report += `✅ ${botId} → ${wh}\n`; }
            else { fail++; report += `❌ ${botId}: ${data.description}\n`; }
          } catch (e) { fail++; report += `❌ ${botId}: ${e.message}\n`; }
        }
      }
    } catch (e) { return send(ctx, cid, `❌ Ошибка: ${e.message}`); }
    return send(ctx, cid, `✅ Готово: ${ok} обновлено, ${fail} ошибок\n\n${report}`.trim());
  }

  if (txt === '/remove_support' || txt.startsWith('/remove_support ')) {
    const role = await getRole(ctx, cid);
    if (role !== 'admin' && role !== 'system_admin') return send(ctx, cid, t(lg, 'support_only_admin'));
    const arg = txt.startsWith('/remove_support ') ? txt.slice(15).trim() : '';
    if (!arg) return send(ctx, cid, t(lg, 'support_remove_usage'));
    if (!ctx.db) return send(ctx, cid, t(lg, 'unknown'));
    const { masterId, masterName } = await resolveMasterInput(ctx, msg, arg);
    if (!masterId) return send(ctx, cid, t(lg, 'support_user_not_found'));
    await removeSupport(ctx, masterId);
    return send(ctx, cid, fill(t(lg, 'support_removed'), { n: escHtml(masterName) }));
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

  if (txt.startsWith('/sysadmin ')) {
    const key = txt.slice(10).trim();
    if (!timingSafeEqual(key, ctx.ADMIN_KEY)) return send(ctx, cid, t(lg, 'adm_wrong_key'));
    // Only the platform creator (adminChatId) can become system_admin — prevents key leak abuse
    if (ctx.adminChatId && cid !== parseInt(String(ctx.adminChatId))) {
      return send(ctx, cid, t(lg, 'sysadm_no_access'));
    }
    if (!ctx.db) return send(ctx, cid, t(lg, 'unknown'));
    await setSystemAdmin(ctx, cid);
    await send(ctx, cid, t(lg, 'sysadm_registered'));
    return showPlatformAdminPanel(ctx, cid, name);
  }

  const realRole = await getRole(ctx, cid);

  // Platform tech ticket: staff follow-up (text or media) → D1 + notify agents / claimed agent
  if (ctx.db && ctx.kv && ctx.tenantId) {
    const staffRoles = ['master', 'admin', 'tenant_owner', 'system_admin'];
    const staffLine = (msg.text || msg.caption || '').trim().slice(0, 2000);
    let staffAtt = null;
    if (msg.photo?.length) staffAtt = `telegram:file_id:${msg.photo[msg.photo.length - 1].file_id}`;
    else if (msg.document?.file_id) staffAtt = `telegram:file_id:${msg.document.file_id}`;
    if (staffRoles.includes(realRole) && (staffLine || staffAtt)) {
      const platTkt = await getTicket(ctx, cid);
      if (platTkt?.open && platTkt.globalTicketId) {
        await appendTicketMessage(ctx, platTkt.globalTicketId, 'client', staffLine, staffAtt);
        const agents = await getTechnicalSupportAgents(ctx);
        const tail = `\n\n<code>${platTkt.globalTicketId}</code>`;
        const snippet = escHtml(staffLine || (staffAtt ? '[файл]' : '')).slice(0, 400);
        if (platTkt.masterCid) {
          try { await send(ctx, platTkt.masterCid, `📩 ${snippet}${tail}`); } catch (_) {}
        } else {
          for (const agId of agents) {
            try { await send(ctx, agId, `📩 ${snippet}${tail}`); } catch (_) {}
          }
        }
        await send(ctx, cid, '✅');
        return;
      }
    }
  }

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
        if (ctx.kv) {
          const ackK = ticketFwdAckKey(cid);
          const seen = await kvGet(ctx, ackK);
          if (!seen) {
            await kvPut(ctx, ackK, true, { expirationTtl: 172800 });
            await send(ctx, cid, t(lg, 'ticket_forwarded_ok'));
          } else {
            await send(ctx, cid, '✅');
          }
        } else {
          await send(ctx, cid, t(lg, 'ticket_forwarded_ok'));
        }
        return;
      }
    } else if (realRole === 'master' || realRole === 'admin' || realRole === 'tenant_owner' || realRole === 'system_admin') {
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
        if (ctx.db) {
          const staffSide = await getTicket(ctx, clientCid);
          if (staffSide?.globalTicketId) {
            await appendTicketMessage(ctx, staffSide.globalTicketId, `support:${cid}`, txt, null);
          }
        }
        return;
      }
    }
  }

  // ─── Role assignment commands ──────────────────────────────────────────────
  if (txt.startsWith('/grant_master') || txt.startsWith('/grant_salon')) {
    const isSalonCmd = txt.startsWith('/grant_salon');
    const targetRole = isSalonCmd ? ROLES.TENANT_OWNER : ROLES.MASTER;
    const cmd = isSalonCmd ? '/grant_salon' : '/grant_master';
    if (realRole !== 'admin' && realRole !== 'system_admin') {
      return send(ctx, cid, t(lg, 'support_only_admin'));
    }
    if (isSalonCmd && realRole !== 'system_admin') {
      return send(ctx, cid, t(lg, 'support_only_admin'));
    }
    const args = txt.slice(cmd.length).trim().split(/\s+/).filter(Boolean);
    const input = args[0];
    const tenantIdArg = args[1] || null;
    if (!input) return send(ctx, cid, fill(t(lg, 'sysadm_grant_usage'), { cmd }));
    const { masterId, masterName } = await resolveMasterInput(ctx, msg, input);
    if (!masterId) {
      const looksLikeUsername = /^@?[a-zA-Z0-9_]{5,32}$/.test(String(input || '').trim());
      return send(ctx, cid, looksLikeUsername ? t(lg, 'adm_master_username_hint') : t(lg, 'support_user_not_found'));
    }
    // Determine target ctx (cross-tenant for system_admin)
    let targetCtx = ctx;
    if (tenantIdArg) {
      targetCtx = { ...ctx, tenantId: tenantIdArg, prefix: `t:${tenantIdArg}:` };
    }
    if (!targetCtx.prefix) return send(ctx, cid, fill(t(lg, 'sysadm_no_tenant_ctx'), { cmd }));
    await setTenantRole(targetCtx, masterId, targetRole);
    const notifLg = await getLang(ctx, masterId) || 'ru';
    try { await send(ctx, masterId, t(notifLg, isSalonCmd ? 'role_granted_owner' : 'role_granted_master')); } catch (_) {}
    return send(ctx, cid, fill(t(lg, 'sysadm_role_granted'), { role: isSalonCmd ? 'salon' : 'master', id: String(masterId), name: escHtml(masterName) }));
  }
  // ──────────────────────────────────────────────────────────────────────────

  if (txt === '/client' && realRole !== 'client') {
    return showWelcome(ctx, cid, name);
  }
  if (txt === '/master' && (realRole === 'admin' || realRole === 'master' || realRole === 'system_admin')) {
    return showMasterPanel(ctx, cid, name);
  }
  if (txt === '/panel' && realRole !== 'client') {
    if (!ctx.tenantId && await isPlatformAdmin(ctx, cid)) return showPlatformAdminPanel(ctx, cid, name);
    if (realRole === 'admin' || realRole === 'tenant_owner' || (ctx.tenantId && realRole === 'system_admin')) return showAdminPanel(ctx, cid, name);
    if (realRole === 'master') return showMasterPanel(ctx, cid, name);
  }

  const startMatch = txt && /^\/start(?:\s+(\S+))?$/.exec(txt);
  if (startMatch) {
    const startPayload = startMatch[1] || null;
    await upsertUserFromTelegram(ctx, cid, msg.from);

    // Record acquisition origin if this is a deep-link /start. The channel is
    // derived from the inbound metadata if present (omnichannel path) and
    // defaults to 'telegram' for native TG updates. Decode failures are logged
    // via the events ring buffer but never block the flow.
    if (startPayload && ctx.tenantId) {
      const decoded = decodeStartPayload(startPayload);
      if (decoded) {
        const channel = msg?._inbound?.channel || 'telegram';
        try {
          await recordOrigin(ctx, {
            chatId: cid,
            channel,
            source: decoded.source,
            medium: decoded.medium,
            campaign: decoded.campaign,
            content: decoded.content,
            rawPayload: startPayload.slice(0, 256),
          });
        } catch (e) {
          console.error('[origins] recordOrigin failed:', e?.message);
        }
      } else {
        void logEvent(ctx, 'origin.invalid_payload', {
          tenantId: ctx.tenantId,
          level: 'warn',
          message: `invalid /start payload from chat=${cid}`,
          data: { payload: startPayload.slice(0, 64) },
        });
      }
    }

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
    // Platform admin panel only in main bot (no tenantId), and only for platform creator (ADMIN_CHAT_ID) or system_admin in KV.
    // Support/technical_support do NOT see platform panel on /start — only isPlatformAdmin.
    if (!ctx.tenantId && await isPlatformAdmin(ctx, cid)) {
      // Set the Web App menu button (God Mode) so it appears both inside chat and as OPEN in chat list
      if (ctx.APP_BASE_URL) {
        api(ctx, 'setChatMenuButton', {
          chat_id: cid,
          menu_button: { type: 'web_app', text: '⚡ God Mode', web_app: { url: `${ctx.APP_BASE_URL}/tg` } },
        }).catch(() => null);
      }
      // Auto-register god-mode commands for this chat so they show in the / menu
      api(ctx, 'setMyCommands', {
        commands: [
          { command: 'start', description: '💅 Главное меню' },
          { command: 'book', description: '📝 Записаться' },
          { command: 'my', description: '📋 Мои записи' },
          { command: 'lang', description: '🌐 Язык' },
          { command: 'panel', description: '🔧 Панель управления' },
          { command: 'admin', description: '🔑 Назначить себя администратором салона (ключ)' },
          { command: 'grant_master', description: '👨‍🎨 Выдать роль мастера @user' },
          { command: 'grant_salon', description: '👑 Назначить Салон @user' },
          { command: 'add_support', description: '👥 Добавить агента поддержки клиентов @user' },
          { command: 'add_technical_support', description: '🔧 Добавить агента техподдержки @user' },
          { command: 'client', description: '👤 Режим клиента' },
          { command: 'master', description: '👨‍🎨 Панель мастера' },
        ],
        scope: { type: 'chat', chat_id: cid },
      }).catch(() => null);
      return showPlatformAdminPanel(ctx, cid, name);
    }
    // In tenant bots: reset per-chat commands to basic set (clears any stale platform commands)
    if (ctx.tenantId) {
      api(ctx, 'setMyCommands', {
        commands: [
          { command: 'start', description: '💅 Главное меню / Main menu' },
          { command: 'book', description: '📝 Записаться / Book now' },
          { command: 'my', description: '📋 Мои записи / My appointments' },
          { command: 'lang', description: '🌐 Язык / Language' },
        ],
        scope: { type: 'chat', chat_id: cid },
      }).catch(() => null);
      if (ctx.APP_BASE_URL && await isAdmin(ctx, cid)) {
        const base = ctx.APP_BASE_URL.replace(/\/$/, '');
        const openChannels = canUse(ctx, 'whatsapp') || canUse(ctx, 'instagram');
        const miniUrl = openChannels ? `${base}/tg?tab=channels` : `${base}/tg`;
        api(ctx, 'setChatMenuButton', {
          chat_id: cid,
          menu_button: { type: 'web_app', text: t(hasLang, 'salon_miniapp_menu'), web_app: { url: miniUrl } },
        }).catch(() => null);
      }
    }
    if (realRole === 'admin' || realRole === 'tenant_owner' || (ctx.tenantId && realRole === 'system_admin')) return showAdminPanel(ctx, cid, name);
    if (realRole === 'master') return showMasterPanel(ctx, cid, name);
    return showWelcome(ctx, cid, name);
  }
  if (txt === '/book')     return startBooking(ctx, cid, msg.from);
  if (txt === '/my')       return showMyApts(ctx, cid);
  if (txt === '/prices')   return showPrices(ctx, cid);
  if (txt === '/catalog')  return showCatalog(ctx, cid);
  if (txt === '/contacts' || txt === '/instagram') return showContacts(ctx, cid);
  if (txt === '/lang')     return showLangPick(ctx, cid);
  if (txt === '/help')     return showHelp(ctx, cid, lg, realRole);

  // ─── Нажатия кнопок постоянной клавиатуры (меню внизу экрана) ─────────────
  if (txt) {
    if (txt === t(lg, 'm_book')) return startBooking(ctx, cid, msg.from);
    if (txt === t(lg, 'm_cat')) return showCatalog(ctx, cid);
    if (txt === t(lg, 'm_prices')) return showPrices(ctx, cid);
    if (txt === t(lg, 'm_my')) return showMyApts(ctx, cid);
    if (txt === t(lg, 'back_m')) return showHomeByRole(ctx, cid, name);
    if (txt === t(lg, 'm_rev')) return showReviews(ctx, cid);
    if (txt === t(lg, 'm_about')) return showAbout(ctx, cid);
    if (txt === t(lg, 'm_cont')) return showContacts(ctx, cid);
    if (txt === t(lg, 'm_lang')) return showLangPick(ctx, cid);
    if (txt === t(lg, 'm_support')) {
      await setState(ctx, cid, { step: STEP.SUPPORT_MSG });
      return send(ctx, cid, t(lg, 'support_enter_msg'), { reply_markup: { inline_keyboard: [[{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]] } });
    }
    if (txt === t(lg, 'm_tech_support') && (realRole === 'master' || realRole === 'admin' || realRole === 'tenant_owner')) {
      await setState(ctx, cid, { step: STEP.TECH_SUPPORT_MSG });
      return send(ctx, cid, t(lg, 'tech_support_enter_msg'), { reply_markup: { inline_keyboard: [[{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]] } });
    }
    if (txt === t(lg, 'mst_panel') && (realRole === 'master' || realRole === 'admin')) return showMasterPanel(ctx, cid, name);
    if (txt === t(lg, 'adm_management') && realRole !== 'client') {
      if (!ctx.tenantId && await isPlatformAdmin(ctx, cid)) return showPlatformAdminPanel(ctx, cid, name);
      if (realRole === 'admin' || realRole === 'tenant_owner' || (ctx.tenantId && realRole === 'system_admin')) return showAdminPanel(ctx, cid, name);
      if (realRole === 'master') return showMasterPanel(ctx, cid, name);
    }
  }

  if (txt) {
    if (isMyAppointmentsMessage(txt)) return showMyApts(ctx, cid);
    const ctxAction = getContextAction(txt);
    if (ctxAction === 'main') return showHomeByRole(ctx, cid, name);
    if (ctxAction === 'prices') return showPrices(ctx, cid);
    if (ctxAction === 'catalog') return showCatalog(ctx, cid);
    if (ctxAction === 'contacts') return showContacts(ctx, cid);
  }

  if (st.step === STEP.CONFIRM && txt) {
    if (isBookingConfirmDeclineText(txt)) {
      return enterBookingAdjustState(ctx, cid, st);
    }
  }

  if (st.step === STEP.BOOK_ADJUST && txt) {
    const quickAdj = parseQuickBookingPhrase(txt);
    if (quickAdj) {
      return startBookingWithService(ctx, cid, msg.from, quickAdj.svcId, quickAdj.dateHint, quickAdj.timeHint, st.masterId ?? null);
    }
    const mention = parseServiceMention(txt, ctx);
    if (mention) {
      return startBookingWithService(ctx, cid, msg.from, mention, st.date, st.time, st.masterId ?? null);
    }
    return handleAIChat(ctx, cid, txt, lg, realRole, msg.from, { bookingAdjust: { date: st.date, time: st.time } });
  }

  // ─── Booking flow: handle typed time when time picker is shown ─────────
  if (st.step === STEP.TIME && txt) {
    const timeM = txt.match(/(\d{1,2})(?::(\d{2}))?/);
    if (timeM) {
      const parsed = timeM[2] ? `${timeM[1]}:${timeM[2]}` : timeM[1];
      const timeHint = resolveTimeHint(parsed);
      if (timeHint) return startBookingWithService(ctx, cid, msg.from, st.svcId, st.date, timeHint, st.masterId ?? null);
    }
  }

  // ─── Booking flow: handle typed date when calendar is shown ────────────
  if (st.step === STEP.DATE && txt) {
    const cleaned = txt.replace(/^(?:на|в|о)\s+/i, '').trim();
    const dateHint = resolveDateHint(cleaned);
    if (dateHint) return startBookingWithService(ctx, cid, msg.from, st.svcId, dateHint, null, st.masterId ?? null);
  }

  if (st.step === STEP.CLIENT_CANCEL_COMMENT) {
    const comment = txt ? txt.slice(0, 500) : '';
    const apt = await cancelApt(ctx, st.aptId, cid);
    await clearState(ctx, cid);
    if (apt) {
      // For staff users who cancelled their own appointment — route back to their panel
      // to avoid confusing "free text → AI → admin actions" DTP scenario
      const cancellerRole = realRole;
      const isStaffCanceller = cancellerRole === 'system_admin' || cancellerRole === 'admin' ||
        cancellerRole === 'master' || cancellerRole === 'tenant_owner';
      if (isStaffCanceller) {
        const backCb = cancellerRole === 'system_admin' ? CB.SYSADM_MAIN
          : (cancellerRole === 'admin' || cancellerRole === 'tenant_owner') ? CB.ADM_MAIN
          : CB.MST_MAIN;
        await send(ctx, cid, fill(t(lg, 'cancel_ok'), {
          svc: svcName(ctx, lg, apt.svcId), dt: fmtDT(lg, apt.date, apt.time),
        }), { reply_markup: { inline_keyboard: [
          [{ text: t(lg, 'back_m'), callback_data: backCb }],
        ] } });
      } else {
        await send(ctx, cid, fill(t(lg, 'cancel_ok'), {
          svc: svcName(ctx, lg, apt.svcId), dt: fmtDT(lg, apt.date, apt.time),
        }), { reply_markup: { inline_keyboard: [
          [{ text: t(lg, 'rebook'), callback_data: CB.BOOK }],
          [{ text: t(lg, 'm_my'), callback_data: CB.MY }],
          [{ text: t(lg, 'back_m'), callback_data: CB.MAIN }],
        ] } });
      }
      await notifyStaffAptCancelled(ctx, apt, comment);
    } else {
      await send(ctx, cid, t(lg, 'cancel_err'), mainKb(lg));
    }
    return;
  }

  if (st.step === STEP.ADD_MASTER) {
    const { masterId, masterName, masterUsername, masterPhone } = await resolveMasterInput(ctx, msg, txt);
    if (!masterId) {
      const looksLikeUsername = /^@?[a-zA-Z0-9_]{5,32}$/.test(String(txt || '').trim());
      return send(ctx, cid, looksLikeUsername ? t(lg, 'adm_master_username_hint') : t(lg, 'adm_master_invalid'));
    }
    // Назначить мастером можно только того, кто уже заходил в этого бота (тот же тенант).
    if (ctx.tenantId) {
      const userInTenant = await getUser(ctx, masterId);
      if (!userInTenant) return send(ctx, cid, t(lg, 'adm_master_must_use_bot_first'));
    }
    const existing = await getMaster(ctx, masterId);
    if (existing) return send(ctx, cid, t(lg, 'adm_master_exists'));
    // Gate: masters limit per plan
    const currentMasters = await listMasters(ctx);
    const mastersLimit = getMastersLimit(ctx);
    if (currentMasters.length >= mastersLimit) {
      return send(ctx, cid, fill(t(lg, 'feature_masters_limit'), { limit: String(mastersLimit) }));
    }
    await saveMaster(ctx, masterId, {
      chatId: masterId,
      name: masterName,
      tgUsername: masterUsername || null,
      phone: masterPhone || null,
      addedAt: nowSec(),
      active: true,
    });
    // In multi-tenant mode also assign the MASTER role so routing works on /start
    if (ctx.prefix) await setTenantRole(ctx, masterId, ROLES.MASTER);
    await clearState(ctx, cid);
    await send(ctx, cid, fill(t(lg, 'adm_master_added'), { n: escHtml(masterName), id: String(masterId) }));
    return showMastersList(ctx, cid);
  }

  if (st.step === STEP.RENAME_MASTER && (await isAdmin(ctx, cid))) {
    const newName = txt ? txt.replace(/<[^>]*>/g, '').trim().slice(0, 50) : '';
    if (newName.length < 2) return send(ctx, cid, t(lg, 'adm_rename_master_err'));
    const masterId = st.renameMasterId;
    const master = await getMaster(ctx, masterId);
    if (!master) { await clearState(ctx, cid); return showMastersList(ctx, cid); }
    master.name = newName;
    master.displayName = newName;
    await saveMaster(ctx, masterId, master);
    await clearState(ctx, cid);
    await send(ctx, cid, fill(t(lg, 'adm_rename_master_done'), { name: escHtml(newName) }));
    return showMastersList(ctx, cid);
  }

  // ─── Platform admin flows (создатель или system_admin) ────────────────────

  async function doRegisterBot(token, tenantId) {
    const webhookSecret = randomId(20);
    const result = await registerBot(ctx, token, tenantId, webhookSecret, ctx.BOT_ENCRYPTION_KEY || null);
    await clearState(ctx, cid);
    if (!result.ok) {
      const errMsg = result.error === 'tenant_has_bot'
        ? t(lg, 'sysadm_bot_already_assigned')
        : result.error || t(lg, 'unknown');
      await send(ctx, cid, `❌ ${errMsg}`);
      return showPlatformAdminPanel(ctx, cid, name);
    }
    const wh = ctx.baseUrl ? `${ctx.baseUrl}/webhook/${result.botId}` : null;
    let webhookSet = false;
    if (wh) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: wh, secret_token: webhookSecret }),
        });
        const data = await r.json();
        webhookSet = data.ok === true;
      } catch (e) {
        console.error('setWebhook error:', e.message);
      }
    }
    const webhookLine = webhookSet
      ? `\n\n${t(lg, 'sysadm_webhook_ok')}`
      : `\n\n${t(lg, 'sysadm_webhook_fail')}\nURL: <code>${wh || '/webhook/' + result.botId}</code>\nSecret: <code>${webhookSecret}</code>`;
    await send(ctx, cid,
      `✅ ${t(lg, 'sysadm_bot_registered')}\n\n` +
      `Bot ID: <code>${result.botId}</code>\n` +
      `Tenant: <code>${result.tenantId}</code>` +
      webhookLine
    );
    return showPlatformAdminPanel(ctx, cid, name);
  }

  if (st.step === STEP.SYSADM_NEW_TENANT && (await isPlatformAdmin(ctx, cid))) {
    const tenantName = txt?.trim();
    if (!tenantName || tenantName.length < 2) return send(ctx, cid, t(lg, 'sysadm_tenant_name_invalid'));
    const result = await createTenant(ctx, tenantName, ctx);
    await clearState(ctx, cid);
    if (result.ok) {
      await send(ctx, cid,
        `✅ ${t(lg, 'sysadm_tenant_created')}\n\n` +
        `ID: <code>${result.tenantId}</code>\n` +
        `${t(lg, 'sysadm_tenant_name_label')}: <b>${escHtml(result.name)}</b>\n\n` +
        `<i>${t(lg, 'sysadm_register_bot_hint')}</i>`
      );
    } else {
      await send(ctx, cid, `❌ ${result.error || t(lg, 'unknown')}`);
    }
    return showPlatformAdminPanel(ctx, cid, name);
  }

  if (st.step === STEP.SYSADM_NEW_BOT && (await isPlatformAdmin(ctx, cid))) {
    const token = txt?.trim();
    if (!token || !token.includes(':') || token.split(':').length < 2) {
      return send(ctx, cid, t(lg, 'sysadm_bot_token_invalid'));
    }
    if (st.preTenantId) {
      return doRegisterBot(token, st.preTenantId);
    }
    await setState(ctx, cid, { step: STEP.SYSADM_NEW_BOT_TENANT, botToken: token });
    return send(ctx, cid, t(lg, 'sysadm_bot_enter_tenant'), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.SYSADM_MAIN }]] },
    });
  }

  if (st.step === STEP.SYSADM_NEW_BOT_TENANT && (await isPlatformAdmin(ctx, cid))) {
    const tenantIdInput = txt?.trim();
    if (!tenantIdInput) return send(ctx, cid, t(lg, 'sysadm_bot_enter_tenant'));
    return doRegisterBot(st.botToken, tenantIdInput);
  }

  if (st.step === STEP.SYSADM_ADD_SUPPORT && (await isPlatformAdmin(ctx, cid))) {
    const arg = txt?.trim();
    if (!arg) return send(ctx, cid, t(lg, 'sysadm_support_enter_user'), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.SYSADM_SUPPORT_LIST }]] },
    });
    const { masterId, masterName } = await resolveMasterInput(ctx, msg, arg);
    if (!masterId) {
      return send(ctx, cid, t(lg, 'sysadm_support_user_invalid'), {
        reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.SYSADM_SUPPORT_LIST }]] },
      });
    }
    await clearState(ctx, cid);
    if (!ctx.db) return send(ctx, cid, t(lg, 'unknown'));
    await addSupport(ctx, masterId);
    await send(ctx, cid, t(lg, 'sysadm_support_added'));
    return showPlatformSupportList(ctx, cid);
  }

  if (st.step === STEP.SYSADM_ADD_TECH_SUPPORT && (await isPlatformAdmin(ctx, cid))) {
    const arg = txt?.trim();
    if (!arg) return send(ctx, cid, t(lg, 'sysadm_tech_support_enter_user'), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.SYSADM_TECH_SUPPORT_LIST }]] },
    });
    const { masterId, masterName } = await resolveMasterInput(ctx, msg, arg);
    if (!masterId) {
      return send(ctx, cid, t(lg, 'sysadm_support_user_invalid'), {
        reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.SYSADM_TECH_SUPPORT_LIST }]] },
      });
    }
    await clearState(ctx, cid);
    if (!ctx.db) return send(ctx, cid, t(lg, 'unknown'));
    await addTechnicalSupport(ctx, masterId);
    await send(ctx, cid, t(lg, 'sysadm_tech_support_added'));
    return showPlatformTechSupportList(ctx, cid);
  }

  if (st.step === STEP.ADM_ADD_TENANT_SUPPORT && (await isAdmin(ctx, cid))) {
    const arg = txt?.trim();
    if (!arg) return send(ctx, cid, t(lg, 'adm_support_enter_user'), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.ADM_SUPPORT_LIST }]] },
    });
    const { masterId, masterName } = await resolveMasterInput(ctx, msg, arg);
    if (!masterId) {
      return send(ctx, cid, t(lg, 'sysadm_support_user_invalid'), {
        reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.ADM_SUPPORT_LIST }]] },
      });
    }
    await clearState(ctx, cid);
    if (!ctx.kv) return send(ctx, cid, t(lg, 'unknown'));
    const added = await addTenantSupportAgent(ctx, masterId);
    if (!added) return send(ctx, cid, t(lg, 'adm_support_limit'));
    await send(ctx, cid, t(lg, 'adm_support_added'));
    return showTenantSupportList(ctx, cid);
  }

  // Google Calendar: master sets calendar ID
  if (st.step === STEP.SET_CALENDAR_ID && (await isMaster(ctx, cid) || await isAdmin(ctx, cid))) {
    const calId = txt?.trim();
    if (!calId || calId.length < 5) {
      return send(ctx, cid, t(lg, 'mst_calendar_enter_id'), {
        reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.MST_CALENDAR }]] },
      });
    }
    await clearState(ctx, cid);
    const master = await getMaster(ctx, cid) || {};
    await saveMaster(ctx, cid, { ...master, googleCalendarId: calId, calendarEnabled: true });
    return send(ctx, cid, fill(t(lg, 'mst_calendar_connected'), { id: escHtml(calId) }), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.MST_CALENDAR }]] },
    });
  }

  if (st.step === STEP.SYSADM_GRANT_INPUT && (await isPlatformAdmin(ctx, cid))) {
    const arg = txt?.trim();
    if (!arg) return send(ctx, cid, fill(t(lg, 'sysadm_grant_enter_user'), { role: st.grantRole || 'master' }), {
      reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.SYSADM_GRANT_ROLE }]] },
    });
    const { masterId, masterName } = await resolveMasterInput(ctx, msg, arg);
    if (!masterId) {
      return send(ctx, cid, t(lg, 'sysadm_support_user_invalid'), {
        reply_markup: { inline_keyboard: [[{ text: t(lg, 'back'), callback_data: CB.SYSADM_GRANT_ROLE }]] },
      });
    }
    const isOwner = st.grantRole === 'salon';
    const targetRole = isOwner ? ROLES.TENANT_OWNER : ROLES.MASTER;
    let targetCtx = ctx;
    if (!targetCtx.prefix) {
      const tenantId = ctx.tenantId;
      if (tenantId) targetCtx = { ...ctx, tenantId, prefix: `t:${tenantId}:` };
    }
    if (targetCtx.prefix) {
      await setTenantRole(targetCtx, masterId, targetRole);
      const notifLg = await getLang(ctx, masterId) || 'ru';
      try { await send(ctx, masterId, t(notifLg, isOwner ? 'role_granted_owner' : 'role_granted_master')); } catch (_) {}
    }
    await clearState(ctx, cid);
    await send(ctx, cid, fill(t(lg, 'sysadm_role_granted'), { role: isOwner ? 'owner' : 'master', id: String(masterId), name: escHtml(masterName) }));
    return showPlatformAdminPanel(ctx, cid, name);
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (st.step === STEP.REJECT_COMMENT) {
    if (!txt) return send(ctx, cid, t(lg, 'mst_reject_prompt'));
    const apt = await getAptById(ctx, st.aptId);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    apt.status = 'rejected';
    apt.rejectComment = txt.slice(0, 500);
    await updateApt(ctx, st.aptId, { status: 'rejected', rejectComment: txt.slice(0, 500) });
    if (apt.googleEventId) {
      await deleteAppointmentCalendar(ctx, apt).catch(e => console.error('reject calendar delete:', e.message));
    }
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
    const apt = await getAptById(ctx, st.aptId);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    apt.status = 'counter_offer';
    apt.counterTime = st.newTime;
    apt.counterComment = comment || null;
    apt.confirmedBy = cid;
    await updateApt(ctx, st.aptId, { status: 'counter_offer', counterTime: st.newTime, counterComment: comment || null, confirmedBy: cid });
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
    const apt = await getAptById(ctx, st.aptId);
    if (!apt || apt.cx) { await clearState(ctx, cid); return; }
    if (reason) await updateApt(ctx, apt.id, { cancelReason: reason });
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
    const apt = await getAptById(ctx, st.aptId);
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

  // ─── Salon settings editing ───────────────────────────────────────────────
  if ((st.step === STEP.EDIT_SALON_NAME || st.step === STEP.EDIT_SALON_PHONE ||
       st.step === STEP.EDIT_SALON_ADDR || st.step === STEP.EDIT_SALON_HOURS_FROM) &&
      (await isAdmin(ctx, cid))) {
    if (!txt) return send(ctx, cid, t(lg, 'unknown'));
    const tenantId = ctx.tenantId;
    if (!ctx.db || !tenantId) {
      await clearState(ctx, cid);
      return send(ctx, cid, t(lg, 'adm_settings_no_tenant'));
    }
    const tenant = await getTenant(ctx, tenantId);
    if (!tenant) {
      await clearState(ctx, cid);
      return send(ctx, cid, t(lg, 'unknown'));
    }
    if (!tenant.salon) tenant.salon = {};
    if (st.step === STEP.EDIT_SALON_NAME) {
      const val = txt.replace(/<[^>]*>/g, '').trim().slice(0, 100);
      if (!val || val.length < 2) return send(ctx, cid, t(lg, 'svc_invalid'));
      tenant.salon.name = val;
      tenant.name = val;
    } else if (st.step === STEP.EDIT_SALON_PHONE) {
      tenant.salon.phone = txt.trim().slice(0, 30);
    } else if (st.step === STEP.EDIT_SALON_ADDR) {
      tenant.salon.address = txt.trim().slice(0, 200);
    } else if (st.step === STEP.EDIT_SALON_HOURS_FROM) {
      const m = txt.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
      if (!m) return send(ctx, cid, t(lg, 'adm_settings_enter_hours'));
      const from = parseInt(m[1]);
      const to = parseInt(m[2]);
      if (isNaN(from) || isNaN(to) || from < 0 || to > 24 || from >= to) return send(ctx, cid, t(lg, 'adm_settings_enter_hours'));
      tenant.salon.workHours = { from, to };
    }
    tenant.updatedAt = nowSec();
    await putTenant(ctx, tenantId, tenant);
    // Reflect changes in ctx for immediate display
    if (ctx.tenant) { ctx.tenant.salon = tenant.salon; ctx.tenant.name = tenant.name; }
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'adm_settings_saved'));
    return showAdminSettings(ctx, cid);
  }
  // ─────────────────────────────────────────────────────────────────────────

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
      if (ctxAction === 'main') return showHomeByRole(ctx, cid, name);
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

  if (txt && getContextAction(txt) === 'main') return showHomeByRole(ctx, cid, name);

  if (txt) {
    const quick = parseQuickBookingPhrase(txt);
    if (quick) {
      return startBookingWithService(ctx, cid, msg.from, quick.svcId, quick.dateHint, quick.timeHint);
    }
    // Detect bare service mention ("педикюр", "на педик", "гель-лак") — start
    // booking with that service even without the "запиши" trigger word.
    const mention = parseServiceMention(txt, ctx);
    if (mention) {
      return startBookingWithService(ctx, cid, msg.from, mention);
    }
  }

  if ((realRole === 'admin' || realRole === 'master' || realRole === 'system_admin') && isConfirmAllRequestsMessage(txt)) {
    const count = await confirmAllPendingApts(ctx, cid);
    const confirmLg = await getLang(ctx, cid) || 'ru';
    const confirmMsg = count > 0 ? fill(t(confirmLg, 'confirm_all_done'), { n: String(count) }) : t(confirmLg, 'confirm_all_none');
    const backCb = realRole === 'system_admin' ? CB.SYSADM_MAIN : realRole === 'admin' ? CB.ADM_MAIN : CB.MST_MAIN;
    return send(ctx, cid, confirmMsg, { reply_markup: { inline_keyboard: [[{ text: t(confirmLg, 'back_m'), callback_data: backCb }]] } });
  }

  if ((realRole === 'admin' || realRole === 'system_admin') && isAdminCancelAllMessage(txt)) {
    return showAdminCancelAllConfirm(ctx, cid);
  }

  if (txt && /\b(отмени|отменить|скасуй|скасувати|cancel|anuluj)\b/i.test(txt) && /\b(все|всі|всё|all|wszystk)/i.test(txt)) {
    if (realRole === 'client') return showCancelAllConfirm(ctx, cid);
    return showAdminCancelAllConfirm(ctx, cid);
  }

  if (!instagramAiTriggerAllows(ctx, txt)) {
    return send(ctx, cid, t(lg, 'ig_ai_trigger_hint'));
  }
  return handleAIChat(ctx, cid, txt, lg, realRole, msg.from);
}

export async function finishPhone(ctx, cid, phone, st) {
  const lg = (await getLang(ctx, cid)) || 'ru';
  const cl = phone.replace(/[^\d+]/g, '').slice(0, 20);
  if (cl.length < 9) return send(ctx, cid, t(lg, 'reg_phone_err'));
  const safeName = escHtml(st.name || '');
  const regTs = nowSec();
  await saveUser(ctx, cid, {
    chatId: cid,
    name: st.name,
    phone: cl,
    tgUsername: st.tgUser || null,
    tgLang: st.tgLang || null,
    registeredAt: regTs,
    tosAcceptedAt: st.tosAcceptedAt || regTs,
  });
  try {
    await audit(ctx, 'tos_accepted', {
      actor: String(cid),
      detail: { channel: ctx.channel?.type || 'telegram', chatId: cid, name: st.name },
    });
  } catch { /* non-critical */ }

  // If the user was mid-booking when they got pulled into the registration
  // gate (flow='book' with a service/date/time already chosen — common on
  // web where the contact gate fires at CB.CONFIRM), drop them back into
  // the booking flow with their selection preserved. Otherwise just show
  // the service picker as before.
  const hadBookingContext = st?.flow === 'book' && st?.svcId;
  await clearState(ctx, cid);
  await send(ctx, cid, fill(t(lg, 'reg_done'), { n: safeName, p: escHtml(cl) }), { reply_markup: { remove_keyboard: true } });

  if (hadBookingContext) {
    const { startBookingWithService } = await import('../ui/booking.js');
    return startBookingWithService(
      ctx, cid,
      // Synthesize a minimal `from` so the helper can build a fallback name
      // if needed; with isRegComplete now satisfied this branch is skipped.
      { first_name: st.name, username: st.tgUser, language_code: st.tgLang },
      st.svcId,
      st.date || null,
      st.time || null,
      st.masterId || null,
    );
  }

  await send(ctx, cid, t(lg, 'now_choose'), svcKb(ctx, lg));
}
