import { send } from '../telegram.js';
import { getLang } from './chat.js';
import { fmtDT } from '../utils/date.js';
import { svcName } from '../utils/helpers.js';
import { CB } from '../config.js';
import { log } from '../utils/logger.js';
import { dispatchAppointmentInApp } from '../notifications.js';
import { getUser } from './users.js';
import { getNoShowPolicy } from './policy/noShowPolicy.js';

/**
 * Per-event bell row metadata. The dispatcher uses this to drop a
 * user_notifications row for the assigned master + tenant owner after
 * every status flip, so the bell reflects the apt lifecycle without
 * each call site having to know about notifyWebUser.
 *
 * `silent: true` means the event still runs side-effects + analytics
 * but no bell row is written (e.g. `appointment.no_show_client` —
 * salon side already sees the consequence in lifetime_visits and the
 * client is silently re-prompted).
 */
const EVENT_INAPP_TITLE = {
  'appointment.done':            'Визит завершён',
  'appointment.no_show_master':  'Мастер не пришёл',
  'appointment.confirmed':       'Запись подтверждена',
  'appointment.rejected':        'Запись отклонена',
  'appointment.cancelled':       'Запись отменена',
  'appointment.rescheduled':     'Запись перенесена',
};

async function dropAppointmentInAppForStaff(ctx, apt, eventType) {
  const title = EVENT_INAPP_TITLE[eventType];
  if (!title) return;
  try {
    const user = await getUser(ctx, apt.chatId).catch(() => null);
    await dispatchAppointmentInApp(ctx, apt, user, eventType, title);
  } catch (e) {
    log.warn('appointmentAutomations', { phase: 'inapp_staff', eventType, error: e?.message?.slice(0, 200) });
  }
}

/**
 * Single dispatch point for status-change side-effects on an appointment.
 *
 * The admin-app routers (`salon.markDone`, `salon.markNoShow`, …) fire a
 * Worker webhook (`POST /admin/appointment-action`). The handler resolves
 * tenant context, loads the apt row, then calls this dispatcher exactly
 * once per click. The dispatcher is the *only* place where post-status
 * client messaging is decided — no hardcoded copy in the per-event branches
 * of `adminKeyHttp.js`. Per the product spec: customisation lives in the
 * marketing module (or paid plugins), not duplicated across routers.
 *
 * Each event type runs:
 *   1. Deterministic D1 side-effects (lifetime_visits++ on done, reminder
 *      cleanup, analytics_events row) — these always apply.
 *   2. Marketing-automations lookup: any enabled row in
 *      `marketing_automations` whose `trigger_type` matches the event is
 *      logged as a future dispatch target (template rendering is wired by
 *      the marketing module in a follow-up PR — this PR only sets the seam).
 *   3. Default client notification — a built-in send that runs whenever no
 *      marketing-automation row OVERRIDES the default. The Marketing UI
 *      can later disable the default by inserting an automation row with
 *      `steps_json='[]'` (a "silent override").
 *
 * `eventType` ∈
 *   'appointment.confirmed' | 'appointment.rejected' | 'appointment.cancelled'
 * | 'appointment.done'      | 'appointment.no_show_client'
 * | 'appointment.no_show_master' | 'appointment.rescheduled'
 */
export async function dispatchAppointmentAutomation(ctx, apt, eventType, opts = {}) {
  if (!apt || !apt.id || !ctx.tenantId) {
    return { notified: false, sideEffects: false, automationsFired: 0 };
  }

  let notified = false;
  let sideEffects = false;
  let automationsFired = 0;

  // ── 1. Deterministic D1 side-effects ────────────────────────────
  try {
    if (eventType === 'appointment.done') {
      // Bump lifetime_visits + stamp last_visit_at on the client row.
      // Also clear reminder flags so the reminder cron stops trying to
      // remind a now-completed appointment.
      const now = Math.floor(Date.now() / 1000);
      if (ctx.db?.prepare && apt.chatId != null) {
        await ctx.db.prepare(
          'UPDATE users SET lifetime_visits = lifetime_visits + 1, last_visit_at = ? ' +
          'WHERE tenant_id = ? AND chat_id = ?'
        ).bind(now, ctx.tenantId, apt.chatId).run().catch(() => undefined);
      }
      if (ctx.db?.prepare) {
        await ctx.db.prepare(
          'UPDATE appointments SET rem_h24 = 1, rem_h2 = 1, sync_retries = 0, ' +
          'sync_retry_after = NULL, sync_last_error = NULL ' +
          'WHERE id = ? AND tenant_id = ?'
        ).bind(apt.id, ctx.tenantId).run().catch(() => undefined);
      }
      sideEffects = true;
    }

    if (eventType === 'appointment.no_show_client') {
      // Bump the client's reliability counter. ONLY for client no-shows — a
      // master no-show is the salon's fault and must never count against the
      // client. Same UPDATE-in-place shape as the lifetime_visits bump, so a
      // re-registration (ON CONFLICT upsert) never clobbers it.
      if (ctx.db?.prepare && apt.chatId != null) {
        await ctx.db.prepare(
          'UPDATE users SET no_show_count = no_show_count + 1 ' +
          'WHERE tenant_id = ? AND chat_id = ?'
        ).bind(ctx.tenantId, apt.chatId).run().catch((e) =>
          log.warn('appointmentAutomations', { action: 'no_show_count_bump_failed', error: e?.message }),
        );
      }
      sideEffects = true;
    }

    // Analytics row for every event so the dashboard can chart status flow.
    if (ctx.db?.prepare) {
      const now = Math.floor(Date.now() / 1000);
      const userId = apt.chatId != null ? String(apt.chatId) : 'unknown';
      const props = JSON.stringify({ appointmentId: apt.id, masterId: apt.masterId ?? null, svcId: apt.svcId ?? null });
      await ctx.db.prepare(
        'INSERT INTO analytics_events (tenant_id, user_id, event, properties, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(ctx.tenantId, userId, eventType, props, now).run().catch(() => undefined);
    }
  } catch (e) {
    log.error('appointmentAutomations', e instanceof Error ? e : new Error(String(e?.message)), { phase: 'side_effects', eventType });
  }

  // ── 2. Marketing-automations dispatch ───────────────────────────
  // Phase 2C: actually FIRE matching automations (Worker-local sender;
  // see `src/services/marketing/automations.js`). Single-recipient mode
  // — sends one email/SMS to the apt's client if they have a
  // marketing_contacts row with consent for the target channel.
  // Tenant-scoped rows AND platform defaults (tenant_id IS NULL) both
  // fire; future PR can add precedence via a `priority` column.
  try {
    if (ctx.db?.prepare) {
      const { fireAutomationForEvent } = await import('./marketing/automations.js');
      const r = await fireAutomationForEvent(ctx, eventType, { chatId: apt.chatId });
      automationsFired = r.fired;
    }
  } catch (e) {
    log.error('appointmentAutomations', e instanceof Error ? e : new Error(String(e?.message)), { phase: 'automations_dispatch', eventType });
  }

  // ── 2.5. Bell row for the assigned master + tenant owner ─────────
  // This is independent of the marketing dispatch — the salon dashboard
  // should always reflect lifecycle events even if no marketing
  // automation is configured. Idempotent via the partial UNIQUE on
  // user_notifications (sourceSlug='appointment', sourceId='${id}:${kind}').
  await dropAppointmentInAppForStaff(ctx, apt, eventType);

  // ── 3. Default client notification ──────────────────────────────
  // Unless an automation row explicitly suppressed it (sentinel for the
  // marketing module to set in PR 3+), run the built-in send. This is
  // the SINGLE source of truth for default copy per event type.
  if (opts.suppressDefault === true) {
    return { notified, sideEffects, automationsFired };
  }

  try {
    if (eventType === 'appointment.done') {
      notified = await sendDefaultDoneMessage(ctx, apt);
    } else if (eventType === 'appointment.no_show_master') {
      notified = await sendDefaultMasterNoShowMessage(ctx, apt);
    } else if (eventType === 'appointment.no_show_client') {
      // Policy-driven: by default the client IS notified (they got reminders
      // and could have cancelled). A tenant can soften (neutral), sharpen
      // (firm), or silence it (notifyClient=false / notifyTone='off') from the
      // no-show policy in Settings.
      const policy = await getNoShowPolicy(ctx);
      notified = await sendDefaultClientNoShowMessage(ctx, apt, policy);
    }
    // 'appointment.confirmed' / 'rejected' / 'cancelled' / 'rescheduled'
    // are still served by the legacy hardcoded branches in
    // adminKeyHttp.js for the existing actions — those will migrate to
    // this dispatcher in a follow-up PR. New actions only here.
  } catch (e) {
    log.error('appointmentAutomations', e instanceof Error ? e : new Error(String(e?.message)), { phase: 'default_send', eventType });
  }

  return { notified, sideEffects, automationsFired };
}

// ── Default messages ──────────────────────────────────────────────
// Inline localization for the three new event types. Kept here (not in
// `i18n/<lang>/master.js`) to keep PR 1 contained — moving these to the
// canonical i18n bundle is part of the marketing-module wiring in PR 3.

const THANK_YOU = {
  ru: '✨ <b>Спасибо, что были у нас!</b>\n\n{svc} · {dt}\n\nНадеемся, вам всё понравилось. Будем рады отзыву ⭐',
  ua: '✨ <b>Дякуємо, що завітали!</b>\n\n{svc} · {dt}\n\nСподіваємось, вам сподобалось. Будемо вдячні за відгук ⭐',
  en: '✨ <b>Thank you for visiting us!</b>\n\n{svc} · {dt}\n\nWe hope you enjoyed it. A review would mean a lot ⭐',
  pl: '✨ <b>Dziękujemy za wizytę!</b>\n\n{svc} · {dt}\n\nMamy nadzieję, że było super. Recenzja zrobi nam dzień ⭐',
};

const APOLOGY_MASTER_NO_SHOW = {
  ru: '🙏 <b>Извините, мастер не смог принять вас в это время</b>\n\n{svc} · {dt}\n\nПожалуйста, выберите новое время — мы хотим вас увидеть снова.',
  ua: '🙏 <b>Вибачте, майстер не зміг прийняти вас у цей час</b>\n\n{svc} · {dt}\n\nБудь ласка, оберіть новий час — ми хочемо побачити вас знову.',
  en: '🙏 <b>Sorry — your master could not make it</b>\n\n{svc} · {dt}\n\nPlease pick a new time. We would love to see you again.',
  pl: '🙏 <b>Przepraszamy — mistrz nie mógł przyjąć</b>\n\n{svc} · {dt}\n\nWybierz nowy termin. Chcielibyśmy znów Cię zobaczyć.',
};

// Client no-show copy, keyed by tone. `neutral` = gentle "we missed you";
// `firm` = matter-of-fact "you didn't show, please cancel ahead next time".
// Both invite a rebooking; `off` (handled before this map) sends nothing.
const CLIENT_NO_SHOW = {
  neutral: {
    ru: '😔 <b>Мы вас не дождались</b>\n\n{svc} · {dt}\n\nЖаль, что не получилось. Если планы поменялись — запишитесь на удобное время.',
    ua: '😔 <b>Ми вас не дочекалися</b>\n\n{svc} · {dt}\n\nШкода, що не вийшло. Якщо плани змінилися — запишіться на зручний час.',
    en: '😔 <b>We missed you</b>\n\n{svc} · {dt}\n\nSorry it did not work out. If your plans changed, book a time that suits you.',
    pl: '😔 <b>Czekaliśmy na Ciebie</b>\n\n{svc} · {dt}\n\nSzkoda, że się nie udało. Jeśli plany się zmieniły — zarezerwuj dogodny termin.',
  },
  firm: {
    ru: '⚠️ <b>Вы пропустили запись</b>\n\n{svc} · {dt}\n\nВы не пришли и не предупредили. Пожалуйста, отменяйте заранее, если не сможете прийти.',
    ua: '⚠️ <b>Ви пропустили запис</b>\n\n{svc} · {dt}\n\nВи не прийшли і не попередили. Будь ласка, скасовуйте заздалегідь, якщо не зможете прийти.',
    en: '⚠️ <b>You missed your appointment</b>\n\n{svc} · {dt}\n\nYou did not show and did not let us know. Please cancel ahead of time if you cannot make it.',
    pl: '⚠️ <b>Nie pojawiłeś się na wizycie</b>\n\n{svc} · {dt}\n\nNie przyszedłeś i nie uprzedziłeś. Prosimy o wcześniejsze odwołanie, jeśli nie możesz przyjść.',
  },
};

function pickLang(map, lg) {
  return map[lg] || map.ru;
}

async function sendDefaultDoneMessage(ctx, apt) {
  if (!apt.chatId) return false;
  const lg = (await getLang(ctx, apt.chatId).catch(() => null)) || 'ru';
  const tpl = pickLang(THANK_YOU, lg);
  const body = tpl
    .replace('{svc}', svcName(ctx, lg, apt.svcId))
    .replace('{dt}', fmtDT(lg, apt.date, apt.time));
  await send(ctx, apt.chatId, body);
  return true;
}

async function sendDefaultClientNoShowMessage(ctx, apt, policy) {
  if (!apt.chatId) return false;
  // Tenant opted out of notifying no-show clients.
  if (!policy?.notifyClient || policy.notifyTone === 'off') return false;
  const lg = (await getLang(ctx, apt.chatId).catch(() => null)) || 'ru';
  const toneMap = CLIENT_NO_SHOW[policy.notifyTone] || CLIENT_NO_SHOW.neutral;
  const tpl = pickLang(toneMap, lg);
  const body = tpl
    .replace('{svc}', svcName(ctx, lg, apt.svcId))
    .replace('{dt}', fmtDT(lg, apt.date, apt.time));
  const rebookBtn = {
    ru: '📅 Записаться снова',
    ua: '📅 Записатися знову',
    en: '📅 Book again',
    pl: '📅 Umów ponownie',
  };
  await send(ctx, apt.chatId, body, {
    reply_markup: {
      inline_keyboard: [[{ text: rebookBtn[lg] || rebookBtn.ru, callback_data: CB.BOOK }]],
    },
  });
  return true;
}

async function sendDefaultMasterNoShowMessage(ctx, apt) {
  if (!apt.chatId) return false;
  const lg = (await getLang(ctx, apt.chatId).catch(() => null)) || 'ru';
  const tpl = pickLang(APOLOGY_MASTER_NO_SHOW, lg);
  const body = tpl
    .replace('{svc}', svcName(ctx, lg, apt.svcId))
    .replace('{dt}', fmtDT(lg, apt.date, apt.time));
  const rebookBtn = {
    ru: '📅 Перебронировать',
    ua: '📅 Перебронювати',
    en: '📅 Rebook',
    pl: '📅 Umów ponownie',
  };
  await send(ctx, apt.chatId, body, {
    reply_markup: {
      inline_keyboard: [[{ text: rebookBtn[lg] || rebookBtn.ru, callback_data: CB.BOOK }]],
    },
  });
  return true;
}
