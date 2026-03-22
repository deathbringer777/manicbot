import { CLEANUP_AFTER_MS, ADDRESS, MAPS_URL } from '../config.js';
import { dbAll, dbRun } from '../utils/db.js';
import { svcName, fill, t, p2 } from '../utils/helpers.js';
import { warsawNow, fmtDT } from '../utils/date.js';
import { send } from '../telegram.js';
import { getLang } from '../services/chat.js';
import { initServices } from '../services/services.js';
import { checkBillingExpiry } from '../billing/lifecycle.js';
import { renewExpiringGoogleWatches } from '../services/google-calendar-oauth.js';

export async function handleCron(ctx) {
  try {
    await initServices(ctx);
    const now = Date.now();
    const w = warsawNow();

    await checkBillingExpiry(ctx, now);

    if (!ctx?.db || !ctx?.tenantId) return;

    try {
      await renewExpiringGoogleWatches(ctx);
    } catch (e) {
      console.error('[gcal] cron watch renew failed:', e.message);
    }

    // Phase 1: reminders
    const reminderDates = [];
    for (const off of [0, 1]) {
      const d = new Date(Date.UTC(w.year, w.month - 1, w.day + off));
      reminderDates.push(`${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`);
    }

    const apts = await dbAll(ctx,
      "SELECT * FROM appointments WHERE tenant_id = ? AND date IN (?, ?) AND cancelled = 0 AND status = 'confirmed'",
      ctx.tenantId, reminderDates[0], reminderDates[1],
    );
    for (const row of apts) {
      try {
        const diffH = (row.ts - now) / 3600000;
        if (diffH < -1 || diffH > 25) continue;
        const do24 = !row.rem_h24 && diffH <= 25 && diffH > 23;
        const do2 = !row.rem_h2 && diffH <= 2.5 && diffH > 1.5;
        if (do24 || do2) {
          const updates = {};
          if (do24) updates.rem_h24 = 1;
          if (do2) updates.rem_h2 = 1;
          const setCols = Object.entries(updates).map(([k]) => `${k} = ?`).join(', ');
          const vals = Object.values(updates);
          await dbRun(ctx, `UPDATE appointments SET ${setCols} WHERE id = ? AND tenant_id = ?`, ...vals, row.id, ctx.tenantId);
        }
        const lg = (await getLang(ctx, row.chat_id)) || 'ru';
        const tenantAddr = ctx.tenant?.salon?.address || ADDRESS;
        const tenantMaps = ctx.tenant?.salon?.mapsUrl || MAPS_URL;
        const vars = { svc: svcName(ctx, lg, row.svc_id), dt: fmtDT(lg, row.date, row.time), addr: tenantAddr, maps: tenantMaps };
        if (do24) await send(ctx, row.chat_id, fill(t(lg, 'rem_24'), vars));
        if (do2) await send(ctx, row.chat_id, fill(t(lg, 'rem_2'), vars));
      } catch (e) {
        console.error(`Cron reminder error for apt ${row.id}:`, e.message);
      }
    }

    // Phase 2: cleanup
    await dbRun(ctx,
      'DELETE FROM appointments WHERE tenant_id = ? AND (cancelled = 1 OR ts < ?)',
      ctx.tenantId, now - CLEANUP_AFTER_MS,
    );
  } catch (e) {
    console.error('Cron error:', e.message);
  }
}
