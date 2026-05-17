/**
 * Reminders plugin — worker cron handler.
 *
 * Invoked once per tenant per cron tick by `phasePluginCron` in
 * src/handlers/cron.js. Window: [-10min, +1min] from `now` (matches the
 * stock `phaseReminders` window). For every active reminder row we expand
 * its recurrence into occurrences that fall inside the window; each
 * occurrence is claimed via INSERT OR IGNORE into `plugin_reminder_fires`
 * (the (reminder_id, fires_at_epoch) UNIQUE index is the idempotency
 * guarantee) and, on a successful claim, delivered via `notifyWebUser`.
 *
 * Delivery state is then UPDATEd back onto the claim row so the runtime
 * panel can show a fire log.
 */

import { dbAll, dbGet, dbRun } from '../../src/utils/db.js';
import { expandOccurrences } from '../../src/lib/recurrence.js';
import { notifyWebUser } from '../../src/services/userNotify.js';
import { getReminderLocale } from './locales.js';
import { log } from '../../src/utils/logger.js';

const WINDOW_BACK_SEC = 10 * 60;
const WINDOW_FORWARD_SEC = 60;

/**
 * @param {object} ctx        — per-tenant worker ctx (db, tenantId, bot…)
 * @param {object} installation — plugin_installations row for ('reminders', tenantId)
 * @param {number} nowMs        — current time in ms (typed so tests can pin)
 */
export async function remindersCron(ctx, installation, nowMs) {
  if (!ctx?.db || !ctx?.tenantId) return { fired: 0, skipped: 0 };
  const tenantId = ctx.tenantId;
  if (installation && installation.tenant_id && installation.tenant_id !== tenantId) {
    // Defensive — orchestrator already filters by tenant.
    return { fired: 0, skipped: 0 };
  }

  const now = Math.floor((nowMs ?? Date.now()) / 1000);
  const windowStart = now - WINDOW_BACK_SEC;
  const windowEnd = now + WINDOW_FORWARD_SEC;
  const fromDate = new Date(windowStart * 1000);
  const toDate = new Date(windowEnd * 1000);

  // Kept on one line — the in-memory test mock parses cols via a regex that
  // does not span newlines.
  const rows = await dbAll(
    ctx,
    'SELECT id, tenant_id, created_by_web_user_id, target_master_id, kind, title, note, starts_on, time, recurrence_json, channels_json FROM plugin_reminders WHERE tenant_id = ? AND archived_at IS NULL',
    tenantId,
  );

  let fired = 0;
  let skipped = 0;
  for (const r of rows) {
    let rec;
    try {
      rec = JSON.parse(r.recurrence_json);
    } catch {
      skipped += 1;
      continue;
    }

    let occurrences;
    try {
      if (rec.type === 'once') {
        // For 'once' the row's `time` is the fire time; combine with anchor.
        const occ = combineAnchorAndTime(r.starts_on, r.time);
        occurrences = occ >= fromDate && occ <= toDate ? [occ] : [];
      } else {
        occurrences = expandOccurrences(rec, r.starts_on, fromDate, toDate);
      }
    } catch (e) {
      log.warn('plugins.reminders.cron', {
        action: 'expand_failed',
        reminderId: r.id,
        error: e?.message,
      });
      skipped += 1;
      continue;
    }

    for (const occ of occurrences) {
      const delivered = await fireOnce(ctx, r, occ);
      if (delivered === 'fired') fired += 1;
      else if (delivered === 'skipped') skipped += 1;
    }
  }

  return { fired, skipped };
}

/**
 * Claim + deliver a single occurrence.
 * @returns 'fired' | 'skipped' | 'failed'
 */
async function fireOnce(ctx, reminder, occurrence) {
  const fireEpoch = Math.floor(occurrence.getTime() / 1000);

  // Idempotency claim — INSERT OR IGNORE against the unique (reminder_id,
  // fires_at_epoch) index. changes=0 means a previous tick already fired.
  let claim;
  try {
    claim = await dbRun(
      ctx,
      "INSERT OR IGNORE INTO plugin_reminder_fires (reminder_id, fires_at_epoch, delivery_state) VALUES (?, ?, 'pending')",
      reminder.id,
      fireEpoch,
    );
  } catch (e) {
    log.error('plugins.reminders.cron', e instanceof Error ? e : new Error(String(e?.message)), {
      action: 'claim_failed',
      reminderId: reminder.id,
    });
    return 'failed';
  }
  const claimed = (claim?.meta?.changes ?? claim?.changes ?? 0) > 0;
  if (!claimed) return 'skipped';

  let channels;
  try {
    channels = JSON.parse(reminder.channels_json);
  } catch {
    channels = ['inapp'];
  }
  if (!Array.isArray(channels) || channels.length === 0) channels = ['inapp'];

  const targets = await resolveTargets(ctx, reminder);
  const lang = await resolveLang(ctx);
  const locale = getReminderLocale(lang);
  const prefix = reminder.kind === 'routine' ? locale.routinePrefix : locale.telegramPrefix;
  const telegramText = reminder.note
    ? `${prefix}\n\n${reminder.title}\n${reminder.note}`
    : `${prefix}\n\n${reminder.title}`;

  let anyOk = false;
  let lastError = null;
  for (const t of targets) {
    try {
      const res = await notifyWebUser(ctx, t.webUserId, {
        kind: 'reminder.fired',
        title: reminder.title,
        body: reminder.note || null,
        link: `/plugin/reminders?id=${reminder.id}`,
        sourceSlug: 'reminders',
        sourceId: `${reminder.id}:${fireEpoch}`,
        inapp: channels.includes('inapp') || true, // in-app always for now
        telegram: channels.includes('telegram'),
        telegramText,
      });
      if (res.ok) anyOk = true;
      else if (!lastError) lastError = res.error ?? 'no_channel_delivered';
    } catch (e) {
      lastError = e?.message?.slice(0, 200) ?? 'unknown';
    }
  }

  try {
    await dbRun(
      ctx,
      'UPDATE plugin_reminder_fires SET fired_at_epoch = ?, delivery_state = ?, delivery_error = ? WHERE reminder_id = ? AND fires_at_epoch = ?',
      Math.floor(Date.now() / 1000),
      anyOk ? 'sent' : 'failed',
      anyOk ? null : (lastError ?? 'no_target'),
      reminder.id,
      fireEpoch,
    );
  } catch (e) {
    log.warn('plugins.reminders.cron', {
      action: 'update_fire_state_failed',
      reminderId: reminder.id,
      error: e?.message,
    });
  }

  return anyOk ? 'fired' : 'failed';
}

function combineAnchorAndTime(ymd, hhmm) {
  const [y, m, d] = ymd.split('-').map((s) => Number(s));
  const [hh, mm] = hhmm.split(':').map((s) => Number(s));
  return new Date(Date.UTC(y, m - 1, d, hh, mm));
}

/**
 * Resolve a reminder's notification targets.
 *
 *  - target_master_id IS NULL → notify the creator (owner / personal master).
 *  - target_master_id set     → look up that master's web_user_id; if missing
 *                               (synthetic, legacy row), fall back to creator.
 */
async function resolveTargets(ctx, reminder) {
  if (reminder.target_master_id) {
    const m = await dbGet(
      ctx,
      'SELECT web_user_id FROM masters WHERE tenant_id = ? AND chat_id = ? LIMIT 1',
      ctx.tenantId,
      reminder.target_master_id,
    );
    if (m?.web_user_id) return [{ webUserId: m.web_user_id }];
  }
  return [{ webUserId: reminder.created_by_web_user_id }];
}

async function resolveLang(ctx) {
  // Tenant default lang lives in tenant_config (key='default_lang'). Fall back to ru.
  try {
    const row = await dbGet(
      ctx,
      "SELECT value FROM tenant_config WHERE tenant_id = ? AND key = 'default_lang'",
      ctx.tenantId,
    );
    if (row?.value && typeof row.value === 'string') return row.value;
  } catch {
    // ignore — best effort
  }
  return 'ru';
}
