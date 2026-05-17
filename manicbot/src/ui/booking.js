import { send } from '../telegram.js';
import { escHtml, fill, t, svcName, isCorrectionSvc } from '../utils/helpers.js';
import { fmtDT, fmtDate, resolveDateHint, resolveTimeHint, findClosestSlot } from '../utils/date.js';
import { CB, STEP } from '../config.js';
import { getLang } from '../services/chat.js';
import { setState } from '../services/state.js';
import { getUser, isRegComplete, listMasters, getFavoriteMasterId } from '../services/users.js';
import { getApts, getSlots } from '../services/appointments.js';
import { getFavoriteSuggest } from '../services/services.js';
import { svcKb, calKb, timeKb } from './keyboards.js';
import { showMyApts } from './screens.js';

export async function startBooking(ctx, cid, from, bookingIntent = null) {
  const lg = await getLang(ctx, cid) || 'ru';
  const user = await getUser(ctx, cid);
  // Spread booking intent into state so finishPhone() can resume the flow
  // after registration completes (it checks st.svcId / st.date / st.time).
  const intentFields = bookingIntent ? {
    ...(bookingIntent.svcId ? { svcId: bookingIntent.svcId } : {}),
    ...(bookingIntent.dateHint ? { date: bookingIntent.dateHint } : {}),
    ...(bookingIntent.timeHint ? { time: bookingIntent.timeHint } : {}),
    ...(bookingIntent.masterId ? { masterId: bookingIntent.masterId } : {}),
  } : {};
  if (!isRegComplete(user)) {
    // Web channel: there's no genuine Telegram name to confirm, so skip
    // REG_CONFIRM and prompt for a typed name directly. This is also
    // safer for embeds (TikTok etc.) where we can't assume we know the
    // visitor at all.
    if (ctx.channel?.type === 'web') {
      await setState(ctx, cid, {
        step: STEP.REG_NAME, flow: 'book',
        tgUser: from?.username || null,
        tgLang: from?.language_code || null,
        ...intentFields,
      });
      return send(ctx, cid, t(lg, 'reg_enter_name'));
    }
    const tgName = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || '?';
    await setState(ctx, cid, {
      step: 'rc', flow: 'book', tgName,
      tgUser: from?.username || null,
      tgLang: from?.language_code || null,
      ...intentFields,
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
  if (!isRegComplete(user)) return startBooking(ctx, cid, from, { svcId, dateHint, timeHint, masterId });
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

const IG_MASTER_PAGE_SIZE = 10; // max masters per page on Instagram

/**
 * Show master selection step during booking.
 * Called after date is chosen. Lists active masters + "any" option.
 * If no masters, skips directly to time selection.
 * On Instagram with >11 masters, paginates to stay within the 13-button limit.
 */
export async function showMasterPick(ctx, cid, svcId, date, st, page = 0) {
  const lg = await getLang(ctx, cid) || 'ru';
  let masters = (await listMasters(ctx)).filter(m => !m.onVacation && m.active !== false);
  if (!masters.length) {
    // No masters — skip master pick, go straight to time
    const slots = await getSlots(ctx, date, svcId, null);
    if (!slots.length) return send(ctx, cid, fill(t(lg, 'no_slots'), { d: fmtDate(lg, date) }), calKb(lg, 0));
    await setState(ctx, cid, { ...st, step: STEP.TIME, masterId: null });
    return send(ctx, cid, `📅 <b>${fmtDate(lg, date)}</b>\n${svcName(ctx, lg, svcId)}\n\n${t(lg, 'choose_time')}`, timeKb(slots, lg));
  }
  await setState(ctx, cid, { ...st, step: STEP.MASTER_PICK });

  // 0074 — favorite-master nudge. When the toggle is ON for this
  // channel and the client has a favorite (manual pin OR derived from
  // history), mark that master with ⭐ and float them to the top so
  // they're the first button the client sees. The data flow degrades
  // gracefully: if either query throws or returns null, we render the
  // legacy alphabetical list with no annotation.
  let favoriteId = null;
  try {
    const channel = ctx.channel?.type || 'telegram';
    if (await getFavoriteSuggest(ctx, channel)) {
      favoriteId = await getFavoriteMasterId(ctx, cid);
    }
  } catch (e) {
    favoriteId = null;
  }
  if (favoriteId != null) {
    const idx = masters.findIndex(m => Number(m.chatId) === Number(favoriteId));
    if (idx > 0) {
      // Reorder in-place: pull the favorite to the front so it's the
      // first row in either the IG-paginated or the full-keyboard branch.
      const [fav] = masters.splice(idx, 1);
      masters = [fav, ...masters];
    } else if (idx < 0) {
      // Favorite is on vacation / inactive — drop the annotation so we
      // don't render a star next to nothing.
      favoriteId = null;
    }
  }
  const labelFor = (m) => {
    const base = fill(t(lg, 'book_master_label'), { name: escHtml(m.name) });
    return Number(m.chatId) === Number(favoriteId)
      ? `⭐ ${base}`
      : base;
  };

  const isIG = ctx.channel?.type === 'instagram';
  const btns = [];

  if (isIG && masters.length > 11) {
    // Instagram: paginate master list (>11 masters won't fit with "any" + back in 13 slots)
    const totalPages = Math.ceil(masters.length / IG_MASTER_PAGE_SIZE);
    const p = Math.max(0, Math.min(page, totalPages - 1));
    const slice = masters.slice(p * IG_MASTER_PAGE_SIZE, (p + 1) * IG_MASTER_PAGE_SIZE);
    // "Any master" only on first page
    if (p === 0) btns.push([{ text: t(lg, 'book_any_master'), callback_data: CB.MASTER_ANY }]);
    for (const m of slice) {
      btns.push([{ text: labelFor(m), callback_data: CB.MASTER_SEL + m.chatId }]);
    }
    const nav = [];
    if (p > 0) nav.push({ text: '◀', callback_data: CB.MASTER_PAGE + (p - 1) });
    if (p < totalPages - 1) nav.push({ text: '▶', callback_data: CB.MASTER_PAGE + (p + 1) });
    if (nav.length) btns.push(nav);
    btns.push([{ text: t(lg, 'back'), callback_data: CB.CAL_BACK }]);
  } else {
    btns.push([{ text: t(lg, 'book_any_master'), callback_data: CB.MASTER_ANY }]);
    for (const m of masters) {
      btns.push([{ text: labelFor(m), callback_data: CB.MASTER_SEL + m.chatId }]);
    }
    btns.push([{ text: t(lg, 'back'), callback_data: CB.CAL_BACK }]);
  }

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
