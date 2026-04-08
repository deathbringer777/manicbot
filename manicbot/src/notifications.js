import { send, sendIcs } from './telegram.js';
import { escHtml, fill, t, svcName, isCorrectionSvc, p2 } from './utils/helpers.js';
import { fmtDT, fmtDate, warsawNow } from './utils/date.js';
import { ADDRESS, MAPS_URL, CB } from './config.js';
import { listMasters, getAdminId, getUser, canManageApt } from './services/users.js';
import { getLang } from './services/chat.js';
import { kvPut, kvGet } from './utils/kv.js';
import { makeICS, makeCalendarUrl } from './utils/ics.js';
import { getAllPendingApts, updateApt } from './services/appointments.js';
import { canUse } from './billing/features.js';
import { syncAppointmentCalendar } from './services/google-calendar-oauth.js';

export async function notifyAptStaff(ctx, apt, user) {
  const adminId = await getAdminId(ctx);
  const recipients = new Set();
  if (apt.masterId) {
    // Assigned to a specific master — notify only that master + admin
    recipients.add(apt.masterId);
  } else {
    // Unassigned — notify all active masters
    const masters = await listMasters(ctx);
    for (const m of masters) if (m.chatId && !m.onVacation) recipients.add(m.chatId);
  }
  if (adminId) recipients.add(adminId);
  if (recipients.size === 0) {
    console.warn('[notifyAptStaff] No recipients for apt', apt.id, '— tenant:', ctx.tenantId,
      '. Ensure masters table and tenant_config.admin are populated in D1 after KV migration.');
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
    })().catch(e => console.error('notifyAptStaff send failed for', rcid, e.message)));
  }
  await Promise.allSettled(promises);
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
    recipients.add(apt.masterId);
  } else {
    const masters = await listMasters(ctx);
    for (const m of masters) if (m.chatId && !m.onVacation) recipients.add(m.chatId);
  }
  if (adminId) recipients.add(adminId);
  if (recipients.size === 0) {
    console.warn('[notifyAptStaffAutoConfirmed] No recipients for apt', apt.id, '— tenant:', ctx.tenantId);
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
    })().catch(e => console.error('notifyAptStaffAutoConfirmed send failed for', rcid, e.message)));
  }
  await Promise.allSettled(promises);
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
        console.error('[calendar] confirmAllPendingApts sync failed:', e.message);
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
  for (const m of masters) if (m.chatId && !m.onVacation) recipients.add(m.chatId);
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
    })().catch(e => console.error('notifyStaffAptCancelled send failed for', rcid, e.message)));
  }
  await Promise.allSettled(promises);
}

export async function notifyStaffConsultantRequest(ctx, clientCid, replyMarkup = null, internalNote = null) {
  const masters = await listMasters(ctx);
  const adminId = await getAdminId(ctx);
  const recipients = new Set();
  for (const m of masters) if (m.chatId && !m.onVacation) recipients.add(Number(m.chatId));
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
    try { await send(ctx, rcid, msg, replyMarkup || {}); } catch (e) { console.error('notifyStaffConsultantRequest send failed for', rcid, e.message); }
  }
}
