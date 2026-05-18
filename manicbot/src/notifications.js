import { send, sendIcs } from './telegram.js';
import { log } from './utils/logger.js';
import { escHtml, fill, t, svcName, isCorrectionSvc, p2 } from './utils/helpers.js';
import { fmtDT, fmtDate, warsawNow } from './utils/date.js';
import { ADDRESS, MAPS_URL, CB } from './config.js';
import { listMasters, getAdminId, getUser, canManageApt, masterTelegramRecipient } from './services/users.js';
import { getLang } from './services/chat.js';
import { kvPut, kvGet } from './utils/kv.js';
import { makeICS, makeCalendarUrl } from './utils/ics.js';
import { getAllPendingApts, updateApt } from './services/appointments.js';
import { canUse } from './billing/features.js';
import { syncAppointmentCalendar } from './services/google-calendar-oauth.js';
import { notifyWebUser } from './services/userNotify.js';
import { dbAll } from './utils/db.js';

export async function notifyAptStaff(ctx, apt, user) {
  const adminId = await getAdminId(ctx);
  const recipients = new Set();
  if (apt.masterId) {
    // Assigned to a specific master — notify only that master + admin.
    // 0072: route through masterTelegramRecipient so paired web-created
    // masters get the ping on their REAL Telegram, not the synthetic
    // 10B+ identity that Telegram would reject.
    const masters = await listMasters(ctx);
    const assigned = masters.find(mm => Number(mm.chatId) === Number(apt.masterId));
    const tg = masterTelegramRecipient(assigned);
    if (tg && !assigned?.onVacation) recipients.add(tg);
  } else {
    // Unassigned — notify all active masters via their real TG chat.
    const masters = await listMasters(ctx);
    for (const m of masters) {
      if (m.onVacation) continue;
      const tg = masterTelegramRecipient(m);
      if (tg) recipients.add(tg);
    }
  }
  if (adminId) recipients.add(adminId);
  if (recipients.size === 0) {
    log.warn('notifications', { message: 'No recipients for apt — ensure masters table and tenant_config.admin are populated in D1 after KV migration', aptId: apt.id, tenantId: ctx.tenantId });
  }
  const promises = [];
  for (const rcid of recipients) {
    promises.push((async () => {
      const lg = await getLang(ctx, rcid) || 'ru';
      const s = ctx.svc.find(x => x.id === apt.svcId);
      const usernameRaw = user?.tgUsername || apt.userTg || '';
      const username = String(usernameRaw).replace(/^@+/, '');
      const client = escHtml(user?.name || apt.userName);
      const phone = escHtml(user?.phone || apt.userPhone);
      const svc = svcName(ctx, lg, apt.svcId);
      const dt = fmtDT(lg, apt.date, apt.time);
      const priceLine = isCorrectionSvc(apt.svcId) ? t(lg, 'free_label') : '💵 ' + String(s?.price || '?') + ' ' + t(lg, 'cur');
      const contactLines = ['👤 ' + client, '📱 ' + phone];
      if (username) contactLines.push('🔗 @' + escHtml(username));
      const reqTxt = [
        '🆕 <b>' + t(lg, 'mst_new_apt_header') + '</b>',
        '',
        ...contactLines,
        '',
        '💅 ' + svc,
        '',
        '📅 ' + dt,
        priceLine,
      ].join('\n');
      await send(ctx, rcid, reqTxt, { reply_markup: { inline_keyboard: [
        [{ text: t(lg, 'mst_confirm_btn'), callback_data: CB.APT_CONFIRM + apt.id }],
        [{ text: t(lg, 'mst_reject_btn'), callback_data: CB.APT_REJECT + apt.id }],
        [{ text: t(lg, 'mst_counter_btn'), callback_data: CB.APT_COUNTER + apt.id }],
      ]}});
    })().catch(e => log.error('notifications', e instanceof Error ? e : new Error(String(e.message)), { action: 'notifyAptStaff_send' })));
  }
  await Promise.allSettled(promises);

  // PR2 of notification center upgrade: also drop an in-app row into
  // user_notifications for every recipient that has a web_users row. The
  // Telegram message above stays as the primary surface; the in-app row
  // is the bell entry, useful for owners/masters who live in the web
  // dashboard and don't have Telegram open. `telegram: false` because
  // we already sent the rich Telegram above — no dup.
  await dispatchAppointmentInApp(ctx, apt, user, 'appointment.created', 'Новая запись').catch((e) =>
    log.error('notifications', e instanceof Error ? e : new Error(String(e?.message)), { action: 'notifyAptStaff_inapp' }),
  );
}

/**
 * Drop an in-app `user_notifications` row for every web-linked recipient
 * of an appointment event (assigned master + tenant owner). Telegram
 * fan-out is NOT done here — the regular `notifyAptStaff` /
 * `notifyAptStaffAutoConfirmed` paths already cover Telegram.
 *
 * Resolves recipients via:
 *   - `masters.web_user_id` (skips synthetic personal-master placeholders)
 *   - `web_users WHERE tenant_id = ? AND role = 'tenant_owner'` (one row)
 *
 * Idempotency: sourceId = apt.id + ':' + kind so the same appointment can
 * trigger multiple kinds (`appointment.created`, `appointment.confirmed`,
 * future `appointment.reschedule`, `appointment.cancelled`) without
 * collapsing.
 */
export async function dispatchAppointmentInApp(ctx, apt, user, kind, titlePrefix) {
  if (!ctx?.db || !ctx?.tenantId) return;
  const targets = new Set();
  try {
    if (apt.masterId) {
      // The assigned master — only when they have a non-synthetic web_users row.
      const rows = await dbAll(
        ctx,
        'SELECT web_user_id FROM masters WHERE tenant_id = ? AND chat_id = ? AND is_synthetic = 0 LIMIT 1',
        ctx.tenantId,
        apt.masterId,
      );
      if (rows[0]?.web_user_id) targets.add(rows[0].web_user_id);
    }
    const ownerRows = await dbAll(
      ctx,
      "SELECT id FROM web_users WHERE tenant_id = ? AND role = 'tenant_owner' LIMIT 1",
      ctx.tenantId,
    );
    if (ownerRows[0]?.id) targets.add(ownerRows[0].id);
  } catch (e) {
    log.warn('notifications', { action: 'dispatchAppointmentInApp.targets', error: e?.message?.slice(0, 200) });
    return;
  }
  if (targets.size === 0) return;

  const clientName = user?.name || apt.userName || 'Клиент';
  const svc = svcName(ctx, 'ru', apt.svcId) || apt.svcId;
  const when = fmtDT('ru', apt.date, apt.time);
  const body = `${clientName} · ${svc} · ${when}`;
  const link = `/?tab=appointments&apt=${encodeURIComponent(apt.id)}`;
  const sourceId = `${apt.id}:${kind}`;

  const calls = [];
  for (const webUserId of targets) {
    calls.push(
      notifyWebUser(ctx, webUserId, {
        kind,
        title: titlePrefix,
        body,
        link,
        sourceSlug: 'appointment',
        sourceId,
        inapp: true,
        telegram: false,
      }).catch((e) =>
        log.warn('notifications', { action: 'dispatchAppointmentInApp.notify', error: e?.message?.slice(0, 200) }),
      ),
    );
  }
  await Promise.allSettled(calls);
}

/**
 * Info-only notification when an appointment is auto-confirmed (per-channel
 * setting). The master sees the same client/service/time card as the
 * regular pending notification, but with no Accept/Reject/Counter buttons —
 * the booking is already locked in. Used by the CB.CONFIRM auto-confirm
 * branch in callback.js.
 */
export async function notifyAptStaffAutoConfirmed(ctx, apt, user) {
  const adminId = await getAdminId(ctx);
  const recipients = new Set();
  if (apt.masterId) {
    // 0072 — paired master notif routing.
    const masters = await listMasters(ctx);
    const assigned = masters.find(mm => Number(mm.chatId) === Number(apt.masterId));
    const tg = masterTelegramRecipient(assigned);
    if (tg && !assigned?.onVacation) recipients.add(tg);
  } else {
    const masters = await listMasters(ctx);
    for (const m of masters) {
      if (m.onVacation) continue;
      const tg = masterTelegramRecipient(m);
      if (tg) recipients.add(tg);
    }
  }
  if (adminId) recipients.add(adminId);
  if (recipients.size === 0) {
    log.warn('notifications', { message: 'No recipients for auto-confirmed apt', aptId: apt.id, tenantId: ctx.tenantId });
  }
  const promises = [];
  for (const rcid of recipients) {
    promises.push((async () => {
      const lg = await getLang(ctx, rcid) || 'ru';
      const s = ctx.svc.find(x => x.id === apt.svcId);
      const usernameRaw = user?.tgUsername || apt.userTg || '';
      const username = String(usernameRaw).replace(/^@+/, '');
      const client = escHtml(user?.name || apt.userName);
      const phone = escHtml(user?.phone || apt.userPhone);
      const svc = svcName(ctx, lg, apt.svcId);
      const dt = fmtDT(lg, apt.date, apt.time);
      const priceLine = isCorrectionSvc(apt.svcId) ? t(lg, 'free_label') : '💵 ' + String(s?.price || '?') + ' ' + t(lg, 'cur');
      const contactLines = ['👤 ' + client, '📱 ' + phone];
      if (username) contactLines.push('🔗 @' + escHtml(username));
      const reqTxt = [
        '✅ <b>' + t(lg, 'mst_auto_confirmed_header') + '</b>',
        '',
        ...contactLines,
        '',
        '💅 ' + svc,
        '',
        '📅 ' + dt,
        priceLine,
      ].join('\n');
      // No accept/reject — the booking is already confirmed. Master can
      // still cancel from the appointments screen if something is wrong.
      await send(ctx, rcid, reqTxt);
    })().catch(e => log.error('notifications', e instanceof Error ? e : new Error(String(e.message)), { action: 'notifyAptStaffAutoConfirmed_send' })));
  }
  await Promise.allSettled(promises);

  // Mirror the Telegram fan-out into the bell for web-linked recipients.
  await dispatchAppointmentInApp(ctx, apt, user, 'appointment.confirmed', 'Запись подтверждена').catch((e) =>
    log.error('notifications', e instanceof Error ? e : new Error(String(e?.message)), { action: 'notifyAptStaffAutoConfirmed_inapp' }),
  );
}

export async function sendAptConfirmedToClient(ctx, apt) {
  const lg = await getLang(ctx, apt.chatId) || 'ru';
  const s = ctx.svc.find(x => x.id === apt.svcId);
  const tpl = isCorrectionSvc(apt.svcId) ? 'booked_correction' : 'booked';
  const tenantAddr = ctx.tenant?.salon?.address || ADDRESS;
  const tenantMaps = ctx.tenant?.salon?.mapsUrl || MAPS_URL;
  const vars = { svc: svcName(ctx, lg, apt.svcId), dt: fmtDT(lg, apt.date, apt.time), addr: tenantAddr, maps: tenantMaps };
  if (!isCorrectionSvc(apt.svcId)) {
    vars.dur = String(s?.dur || '?'); vars.min = t(lg, 'min');
    vars.p = String(s?.price || '?'); vars.c = t(lg, 'cur');
  }
  await send(ctx, apt.chatId, fill(t(lg, tpl), vars));
  const ics = makeICS(ctx, apt, lg);
  if (ics) await sendIcs(ctx, apt.chatId, ics, 'manicure.ics', '');
  // Send a web link for non-Telegram channels or as a fallback
  const calUrl = await makeCalendarUrl(ctx, apt.id);
  if (calUrl) {
    const linkText = { ru: '📅 Добавить в календарь', en: '📅 Add to calendar', pl: '📅 Dodaj do kalendarza', ua: '📅 Додати до календаря' };
    await send(ctx, apt.chatId, `<a href="${calUrl}">${linkText[lg] || linkText.ru}</a>`, { parse_mode: 'HTML' });
  }
}

/**
 * Notify the client that a salon owner moved their appointment to a new slot.
 *
 * Triggered by the admin-app `appointments.update` mutation via POST
 * `/admin/appointment-action` action="reschedule". The Worker is the single
 * source of truth for channel routing (TG/IG/WA) and language resolution,
 * so the mutation only fires the webhook — the message body is rendered here.
 *
 * `oldDate` / `oldTime` are the values BEFORE the update (passed through the
 * webhook); `apt` already holds the new ones from `getAptById`.
 */
export async function sendAptRescheduledToClient(ctx, apt, oldDate, oldTime) {
  const lg = (await getLang(ctx, apt.chatId)) || 'ru';
  const svc = svcName(ctx, lg, apt.svcId);
  const newDt = fmtDT(lg, apt.date, apt.time);
  // Old date/time may be missing for a master-only or service-only update —
  // fall back to the current values so the message still makes sense.
  const oldDt = oldDate && oldTime ? fmtDT(lg, oldDate, oldTime) : newDt;
  const body = fill(t(lg, 'apt_rescheduled'), { svc, oldDt, newDt });
  await send(ctx, apt.chatId, body);
  const ics = makeICS(ctx, apt, lg);
  if (ics) await sendIcs(ctx, apt.chatId, ics, 'manicure.ics', '');
  const calUrl = await makeCalendarUrl(ctx, apt.id);
  if (calUrl) {
    const linkText = { ru: '📅 Обновить в календаре', en: '📅 Update in calendar', pl: '📅 Zaktualizuj w kalendarzu', ua: '📅 Оновити в календарі' };
    await send(ctx, apt.chatId, `<a href="${calUrl}">${linkText[lg] || linkText.ru}</a>`, { parse_mode: 'HTML' });
  }
}

export async function confirmAllPendingApts(ctx, cid) {
  if (!await canManageApt(ctx, cid)) return 0;
  const pending = await getAllPendingApts(ctx);
  let count = 0;
  for (const apt of pending) {
    apt.status = 'confirmed';
    apt.confirmedBy = cid;
    if (!apt.masterId) apt.masterId = cid;
    await updateApt(ctx, apt.id, { status: 'confirmed', confirmedBy: cid, masterId: apt.masterId });
    await sendAptConfirmedToClient(ctx, apt);

    if (canUse(ctx, 'calendar')) {
      try {
        await syncAppointmentCalendar(ctx, apt);
      } catch (e) {
        log.error('notifications', e instanceof Error ? e : new Error(String(e.message)), { action: 'confirmAllPendingApts_calendar_sync' });
      }
    }

    count++;
  }
  return count;
}

export async function notifyStaffAptCancelled(ctx, apt, comment = null) {
  const masters = await listMasters(ctx);
  const adminId = await getAdminId(ctx);
  const recipients = new Set();
  for (const m of masters) {
    if (m.onVacation) continue;
    const tg = masterTelegramRecipient(m);
    if (tg) recipients.add(tg);
  }
  if (adminId) recipients.add(adminId);
  const user = await getUser(ctx, apt.chatId);
  const usernameRaw = apt.userTg || user?.tgUsername || '';
  const username = String(usernameRaw).replace(/^@+/, '');
  const promises = [];
  for (const rcid of recipients) {
    promises.push((async () => {
      const lg = await getLang(ctx, rcid) || 'ru';
      const usernamePart = username ? ` | 🔗 @${escHtml(username)}` : '';
      const lines = [
        t(lg, 'staff_apt_cancelled_client'),
        '',
        `👤 ${escHtml(apt.userName)} | 📱 ${escHtml(apt.userPhone)}${usernamePart}`,
        '',
        `💅 ${svcName(ctx, lg, apt.svcId)}`,
        `📅 ${fmtDT(lg, apt.date, apt.time)}`,
      ];
      if (comment && String(comment).trim()) {
        lines.push('', `💬 ${escHtml(String(comment).trim())}`);
      }
      await send(ctx, rcid, lines.join('\n'));
    })().catch(e => log.error('notifications', e instanceof Error ? e : new Error(String(e.message)), { action: 'notifyStaffAptCancelled_send' })));
  }
  await Promise.allSettled(promises);

  // Mirror into the bell so web-linked staff see the cancellation.
  await dispatchAppointmentInApp(ctx, apt, user, 'appointment.cancelled', 'Запись отменена').catch((e) =>
    log.error('notifications', e instanceof Error ? e : new Error(String(e?.message)), { action: 'notifyStaffAptCancelled_inapp' }),
  );
}

/**
 * Drop a bell row for the assigned master + tenant owner when an
 * appointment is rescheduled. Used by the Worker `/admin/appointment-action
 * reschedule` action AFTER the existing client-facing notification.
 */
export async function notifyStaffAptRescheduled(ctx, apt, oldDate, oldTime) {
  if (!ctx?.db || !ctx?.tenantId || !apt) return;
  const user = await getUser(ctx, apt.chatId).catch(() => null);
  const oldDt = oldDate && oldTime ? fmtDT('ru', oldDate, oldTime) : null;
  const newDt = fmtDT('ru', apt.date, apt.time);
  const body = oldDt
    ? `${user?.name || apt.userName || 'Клиент'} · ${oldDt} → ${newDt}`
    : `${user?.name || apt.userName || 'Клиент'} · ${newDt}`;
  // Reuse dispatchAppointmentInApp but with custom body — wrap manually
  // since the default formats "name · svc · when" not "name · old → new".
  const targets = new Set();
  try {
    if (apt.masterId) {
      const rows = await dbAll(
        ctx,
        'SELECT web_user_id FROM masters WHERE tenant_id = ? AND chat_id = ? AND is_synthetic = 0 LIMIT 1',
        ctx.tenantId,
        apt.masterId,
      );
      if (rows[0]?.web_user_id) targets.add(rows[0].web_user_id);
    }
    const ownerRows = await dbAll(
      ctx,
      "SELECT id FROM web_users WHERE tenant_id = ? AND role = 'tenant_owner' LIMIT 1",
      ctx.tenantId,
    );
    if (ownerRows[0]?.id) targets.add(ownerRows[0].id);
  } catch (e) {
    log.warn('notifications', { action: 'notifyStaffAptRescheduled.targets', error: e?.message?.slice(0, 200) });
    return;
  }
  if (targets.size === 0) return;

  const link = `/?tab=appointments&apt=${encodeURIComponent(apt.id)}`;
  const sourceId = `${apt.id}:rescheduled:${apt.date}_${apt.time}`;
  const calls = [];
  for (const webUserId of targets) {
    calls.push(
      notifyWebUser(ctx, webUserId, {
        kind: 'appointment.rescheduled',
        title: 'Запись перенесена',
        body,
        link,
        sourceSlug: 'appointment',
        sourceId,
        inapp: true,
        telegram: false,
      }).catch((e) =>
        log.warn('notifications', { action: 'notifyStaffAptRescheduled.notify', error: e?.message?.slice(0, 200) }),
      ),
    );
  }
  await Promise.allSettled(calls);
}

export async function notifyStaffConsultantRequest(ctx, clientCid, replyMarkup = null, internalNote = null) {
  const masters = await listMasters(ctx);
  const adminId = await getAdminId(ctx);
  const recipients = new Set();
  for (const m of masters) {
    if (m.onVacation) continue;
    const tg = masterTelegramRecipient(m);
    if (tg) recipients.add(Number(tg));
  }
  if (adminId) recipients.add(Number(adminId));
  if (ctx.adminChatId) recipients.add(Number(ctx.adminChatId));
  const user = await getUser(ctx, clientCid);
  const name = user?.name ? escHtml(user.name) : '—';
  const phone = user?.phone ? escHtml(user.phone) : '—';
  const username = user?.tgUsername ? `@${escHtml(user.tgUsername)}` : '—';
  const salonName = escHtml(ctx.tenant?.salon?.name || ctx.SALON_NAME || '');
  const salonPrefix = salonName ? `🏠 <b>${salonName}</b>\n` : '';
  for (const rcid of recipients) {
    const rlg = await getLang(ctx, rcid) || 'ru';
    let msg = salonPrefix + fill(t(rlg, 'consultant_notify'), { name, phone, username });
    if (internalNote && internalNote.trim()) {
      msg += '\n\n' + fill(t(rlg, 'ticket_internal_note'), { note: escHtml(internalNote.trim()) });
    }
    try { await send(ctx, rcid, msg, replyMarkup || {}); } catch (e) { log.error('notifications', e instanceof Error ? e : new Error(String(e.message)), { action: 'notifyStaffConsultantRequest_send' }); }
  }
}
