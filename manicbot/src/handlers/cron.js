import { CLEANUP_AFTER_MS, ADDRESS, MAPS_URL } from '../config.js';
import { kvGet, kvPut, kvDel, kvListAll } from '../utils/kv.js';
import { dbAll, dbRun } from '../utils/db.js';
import { svcName, fill, t, p2 } from '../utils/helpers.js';
import { warsawNow, fmtDT } from '../utils/date.js';
import { send } from '../telegram.js';
import { getLang } from '../services/chat.js';
import { initServices } from '../services/services.js';
import { getAptMasterId } from '../services/appointments.js';
import { checkBillingExpiry } from '../billing/lifecycle.js';

export async function handleCron(ctx) {
  try {
    await initServices(ctx);
    const now = Date.now();
    const w = warsawNow();

    // Phase 0: billing status transitions (trial/grace → inactive)
    // Логика перехода вынесена в src/billing/lifecycle.js для переиспользования и тестирования.
    await checkBillingExpiry(ctx, now);

    // Phase 1: reminders
    const reminderDates = [];
    for (const off of [0, 1]) {
      const d = new Date(Date.UTC(w.year, w.month - 1, w.day + off));
      reminderDates.push(`${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`);
    }

    if (ctx?.db && ctx?.tenantId) {
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
          const vars = { svc: svcName(ctx, lg, row.svc_id), dt: fmtDT(lg, row.date, row.time), addr: ADDRESS, maps: MAPS_URL };
          if (do24) await send(ctx, row.chat_id, fill(t(lg, 'rem_24'), vars));
          if (do2) await send(ctx, row.chat_id, fill(t(lg, 'rem_2'), vars));
        } catch (e) {
          console.error(`Cron reminder error for apt ${row.id}:`, e.message);
        }
      }
    } else {
      for (const date of reminderDates) {
        const ids = (await kvGet(ctx, `d:${date}`)) || [];
        for (const id of ids) {
          try {
            const a = await kvGet(ctx, `ap:${id}`);
            if (!a || a.cx) continue;
            if (a.status && a.status !== 'confirmed') continue;
            const diffH = (a.ts - now) / 3600000;
            if (diffH < -1 || diffH > 25) continue;
            const lg = (await getLang(ctx, a.chatId)) || 'ru';
            const vars = { svc: svcName(ctx, lg, a.svcId), dt: fmtDT(lg, a.date, a.time), addr: ADDRESS, maps: MAPS_URL };
            const do24 = !a.rem.h24 && diffH <= 25 && diffH > 23;
            const do2 = !a.rem.h2 && diffH <= 2.5 && diffH > 1.5;
            if (do24) a.rem.h24 = true;
            if (do2) a.rem.h2 = true;
            if (do24 || do2) await kvPut(ctx, `ap:${id}`, a);
            if (do24) await send(ctx, a.chatId, fill(t(lg, 'rem_24'), vars));
            if (do2) await send(ctx, a.chatId, fill(t(lg, 'rem_2'), vars));
          } catch (e) {
            console.error(`Cron reminder error for apt ${id}:`, e.message);
          }
        }
      }
    }

    // Phase 2: cleanup
    if (ctx?.db && ctx?.tenantId) {
      await dbRun(ctx,
        'DELETE FROM appointments WHERE tenant_id = ? AND (cancelled = 1 OR ts < ?)',
        ctx.tenantId, now - CLEANUP_AFTER_MS,
      );
    } else {
      const monthsToClean = [];
      for (const off of [-1, 0]) {
        const d = new Date(Date.UTC(w.year, w.month - 1 + off, 1));
        monthsToClean.push(`all:${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`);
      }
      const cleanedAptIds = new Set();
      for (const monthKey of monthsToClean) {
        const allIds = (await kvGet(ctx, monthKey)) || [];
        const kept = [];
        for (const id of allIds) {
          try {
            const a = await kvGet(ctx, `ap:${id}`);
            if (!a) continue;
            if ((a.ts < now - CLEANUP_AFTER_MS) || a.cx) {
              cleanedAptIds.add(id);
              await kvDel(ctx, `ap:${id}`);
              const dKey = `d:${a.date}`;
              const dl = (await kvGet(ctx, dKey)) || [];
              const newDl = dl.filter(x => x !== id);
              if (newDl.length !== dl.length) {
                if (newDl.length === 0) await kvDel(ctx, dKey);
                else await kvPut(ctx, dKey, newDl);
              }
              continue;
            }
            kept.push(id);
          } catch (e) {
            console.error(`Cron cleanup error for apt ${id}:`, e.message);
            kept.push(id);
          }
        }
        if (kept.length !== allIds.length) {
          if (kept.length === 0) await kvDel(ctx, monthKey);
          else await kvPut(ctx, monthKey, kept);
        }
      }
      if (cleanedAptIds.size > 0) {
        const userKeys = await kvListAll(ctx, { prefix: 'ua:' });
        for (const k of userKeys) {
          try {
            const ids = (await kvGet(ctx, k.name)) || [];
            const pruned = ids.filter(id => !cleanedAptIds.has(id));
            if (pruned.length !== ids.length) {
              if (pruned.length === 0) await kvDel(ctx, k.name);
              else await kvPut(ctx, k.name, pruned);
            }
          } catch (e) {
            console.error(`Cron ua cleanup error for ${k.name}:`, e.message);
          }
        }
      }
    }
  } catch (e) {
    console.error('Cron error:', e.message);
  }
}
