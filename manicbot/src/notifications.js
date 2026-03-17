import { send, sendIcs } from './telegram.js';
import { escHtml, fill, t, svcName, isCorrectionSvc } from './utils/helpers.js';
import { fmtDT, fmtDate, warsawNow } from './utils/date.js';
import { ADDRESS, MAPS_URL, CB } from './config.js';
import { listMasters, getAdminId, getUser, getMaster } from './services/users.js';
import { getLang } from './services/chat.js';
import { kvPut, kvGet } from './utils/kv.js';
import { makeICS } from './utils/ics.js';
import { p2 } from './utils/helpers.js';
import { getAllPendingApts } from './services/appointments.js';
import { canManageApt } from './services/users.js';
import { canUse } from './billing/features.js';
import { createCalendarEvent, buildCalendarEvent } from './services/calendar.js';

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
    })());
  }
  await Promise.all(promises);
}

export async function sendAptConfirmedToClient(ctx, apt) {
  const lg = await getLang(ctx, apt.chatId) || 'ru';
  const s = ctx.svc.find(x => x.id === apt.svcId);
  const tpl = isCorrectionSvc(apt.svcId) ? 'booked_correction' : 'booked';
  const vars = { svc: svcName(ctx, lg, apt.svcId), dt: fmtDT(lg, apt.date, apt.time), addr: ADDRESS, maps: MAPS_URL };
  if (!isCorrectionSvc(apt.svcId)) {
    vars.dur = String(s?.dur || '?'); vars.min = t(lg, 'min');
    vars.p = String(s?.price || '?'); vars.c = t(lg, 'cur');
  }
  await send(ctx, apt.chatId, fill(t(lg, tpl), vars));
  const ics = makeICS(ctx, apt, lg);
  if (ics) await sendIcs(ctx, apt.chatId, ics, 'manicure.ics', '');
}

export async function confirmAllPendingApts(ctx, cid) {
  if (!await canManageApt(ctx, cid)) return 0;
  const pending = await getAllPendingApts(ctx);
  let count = 0;
  for (const apt of pending) {
    apt.status = 'confirmed';
    apt.confirmedBy = cid;
    await kvPut(ctx, `ap:${apt.id}`, apt);
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
            await kvPut(ctx, `ap:${apt.id}`, apt);
          }
        }
      } catch (e) {
        console.error('[calendar] confirmAllPendingApts event creation failed:', e.message);
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
    })());
  }
  await Promise.all(promises);
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
    await send(ctx, rcid, msg, replyMarkup || {});
  }
}
