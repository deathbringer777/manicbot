import { send } from '../telegram.js';
import { escHtml, fill, t, svcName, isCorrectionSvc } from '../utils/helpers.js';
import { fmtDT, fmtDate, resolveDateHint, resolveTimeHint, findClosestSlot } from '../utils/date.js';
import { CB, STEP } from '../config.js';
import { getLang } from '../services/chat.js';
import { setState } from '../services/state.js';
import { getUser, listMasters } from '../services/users.js';
import { getApts, getSlots } from '../services/appointments.js';
import { svcKb, calKb, timeKb } from './keyboards.js';
import { showMyApts } from './screens.js';

export async function startBooking(ctx, cid, from) {
  const lg = await getLang(ctx, cid) || 'ru';
  const user = await getUser(ctx, cid);
  if (!user) {
    const tgName = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || '?';
    await setState(ctx, cid, {
      step: 'rc', flow: 'book', tgName,
      tgUser: from?.username || null,
      tgLang: from?.language_code || null,
    });
    return send(ctx, cid, fill(t(lg, 'reg_confirm_name'), { n: escHtml(tgName) }), {
      reply_markup: { inline_keyboard: [
        [{ text: t(lg, 'reg_yes'), callback_data: CB.REG_YES }],
        [{ text: t(lg, 'reg_change'), callback_data: CB.REG_CHANGE }],
      ] },
    });
  }
  await send(ctx, cid, t(lg, 'choose_svc'), svcKb(ctx, lg));
}

export async function startBookingWithService(ctx, cid, from, svcId, dateHint = null, timeHint = null, masterId = null) {
  const lg = await getLang(ctx, cid) || 'ru';
  if (!ctx.svcIds?.has(svcId)) return startBooking(ctx, cid, from);
  const user = await getUser(ctx, cid);
  if (!user) return startBooking(ctx, cid, from);
  const s = ctx.svc.find(x => x.id === svcId);
  if (!s) return startBooking(ctx, cid, from);

  const dateStr = dateHint ? resolveDateHint(dateHint) : null;
  const timeStr = timeHint ? resolveTimeHint(timeHint) : null;

  if (dateStr) {
    const slots = await getSlots(ctx, dateStr, svcId, masterId ?? null);
    if (!slots.length) {
      await setState(ctx, cid, { step: 'date', svcId });
      return send(ctx, cid, fill(t(lg, 'no_slots'), { d: fmtDate(lg, dateStr) }) + '\n\n' + t(lg, 'choose_date'), calKb(lg, 0));
    }
    if (timeStr) {
      const slot = slots.includes(timeStr) ? timeStr : findClosestSlot(slots, timeStr);
      if (slot) {
        await setState(ctx, cid, { step: 'conf', svcId, date: dateStr, time: slot, masterId: masterId ?? null });
        const confLines = isCorrectionSvc(svcId)
          ? [fill(t(lg, 'confirm_correction'), { svc: svcName(ctx, lg, svcId), dt: fmtDT(lg, dateStr, slot), name: escHtml(user?.name || '—'), phone: escHtml(user?.phone || '—') })]
          : [t(lg, 'confirm_title'), '', svcName(ctx, lg, svcId), `📅 ${fmtDT(lg, dateStr, slot)}`, `⏱ ${s.dur} ${t(lg, 'min')}`, `💵 ${s.price} ${t(lg, 'cur')}`, '', `👤 ${escHtml(user?.name || '—')}`, `📱 ${escHtml(user?.phone || '—')}`];
        return send(ctx, cid, confLines.join('\n'), { reply_markup: { inline_keyboard: [
          [{ text: t(lg, 'confirm_yes'), callback_data: CB.CONFIRM }],
          [{ text: t(lg, 'confirm_no'), callback_data: CB.CANCEL_BOOK }],
        ] } });
      }
    }
    await setState(ctx, cid, { step: 'time', svcId, date: dateStr, masterId: masterId ?? null });
    return send(ctx, cid, `📅 <b>${fmtDate(lg, dateStr)}</b>\n${svcName(ctx, lg, svcId)}\n\n${t(lg, 'choose_time')}`, timeKb(slots, lg));
  }

  await setState(ctx, cid, { step: 'date', svcId });
  const chosenText = isCorrectionSvc(svcId)
    ? fill(t(lg, 'chosen_correction'), { svc: svcName(ctx, lg, svcId) }) + '\n\n' + t(lg, 'choose_date')
    : fill(t(lg, 'chosen'), { svc: svcName(ctx, lg, svcId), p: String(s.price), c: t(lg, 'cur'), d: String(s.dur), min: t(lg, 'min') }) + '\n\n' + t(lg, 'choose_date');
  await send(ctx, cid, chosenText, calKb(lg, 0));
}

/** After user declines confirmation — keep slot, allow service change via text or catalog. */
export async function enterBookingAdjustState(ctx, cid, prev) {
  const lg = await getLang(ctx, cid) || 'ru';
  if (!prev?.date || !prev?.time || !prev?.svcId) return;
  await setState(ctx, cid, {
    step: STEP.BOOK_ADJUST,
    svcId: prev.svcId,
    date: prev.date,
    time: prev.time,
    masterId: prev.masterId ?? null,
  });
  return send(ctx, cid, fill(t(lg, 'book_confirm_declined'), { dt: fmtDT(lg, prev.date, prev.time) }), {
    reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'book_repick_service'), callback_data: CB.BOOK_PICK_SVC }],
      [{ text: t(lg, 'm_book'), callback_data: CB.BOOK }],
      [{ text: t(lg, 'back_m'), callback_data: CB.MAIN }],
    ] },
  });
}

/**
 * Show master selection step during booking.
 * Called after date is chosen. Lists active masters + "any" option.
 * If no masters, skips directly to time selection.
 */
export async function showMasterPick(ctx, cid, svcId, date, st) {
  const lg = await getLang(ctx, cid) || 'ru';
  const masters = (await listMasters(ctx)).filter(m => !m.onVacation && m.active !== false);
  if (!masters.length) {
    // No masters — skip master pick, go straight to time
    const slots = await getSlots(ctx, date, svcId, null);
    if (!slots.length) return send(ctx, cid, fill(t(lg, 'no_slots'), { d: fmtDate(lg, date) }), calKb(lg, 0));
    await setState(ctx, cid, { ...st, step: STEP.TIME, masterId: null });
    return send(ctx, cid, `📅 <b>${fmtDate(lg, date)}</b>\n${svcName(ctx, lg, svcId)}\n\n${t(lg, 'choose_time')}`, timeKb(slots, lg));
  }
  await setState(ctx, cid, { ...st, step: STEP.MASTER_PICK });
  const btns = [];
  btns.push([{ text: t(lg, 'book_any_master'), callback_data: CB.MASTER_ANY }]);
  for (const m of masters) {
    btns.push([{ text: fill(t(lg, 'book_master_label'), { name: escHtml(m.name) }), callback_data: CB.MASTER_SEL + m.chatId }]);
  }
  btns.push([{ text: t(lg, 'back'), callback_data: CB.CAL_BACK }]);
  await send(ctx, cid, t(lg, 'book_choose_master'), { reply_markup: { inline_keyboard: btns } });
}

export async function showCancelAllConfirm(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const apts = await getApts(ctx, cid);
  if (!apts.length) return showMyApts(ctx, cid);
  return send(ctx, cid, fill(t(lg, 'cancel_all_confirm'), { n: String(apts.length) }), {
    reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'cancel_all_yes'), callback_data: CB.CANCEL_ALL_YES }],
      [{ text: t(lg, 'cancel_no'), callback_data: CB.MY }],
    ] },
  });
}
