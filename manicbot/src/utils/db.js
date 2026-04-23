/**
 * D1 helper layer — thin wrappers around ctx.db (Cloudflare D1 binding).
 * Mirrors the kvGet/kvPut pattern: catch on SELECT, throw on mutations.
 */
import { log } from './logger.js';

export async function dbGet(ctx, sql, ...params) {
  try {
    const result = await ctx.db.prepare(sql).bind(...params).first();
    return result || null;
  } catch (e) {
    log.error('utils.db', e instanceof Error ? e : new Error(String(e.message)), { op: 'GET', sql });
    return null;
  }
}

export async function dbAll(ctx, sql, ...params) {
  try {
    const result = await ctx.db.prepare(sql).bind(...params).all();
    return result.results || [];
  } catch (e) {
    log.error('utils.db', e instanceof Error ? e : new Error(String(e.message)), { op: 'ALL', sql });
    return [];
  }
}

export async function dbRun(ctx, sql, ...params) {
  const result = await ctx.db.prepare(sql).bind(...params).run();
  return result;
}

/**
 * Safe variant of dbRun: catches SQL errors and returns { ok, error } instead of throwing.
 * Use for fire-and-forget mutations where a crash would be worse than a silent failure.
 * @returns {{ ok: boolean, error?: string }}
 */
export async function dbRunSafe(ctx, sql, ...params) {
  try {
    await ctx.db.prepare(sql).bind(...params).run();
    return { ok: true };
  } catch (e) {
    log.error('utils.db', e instanceof Error ? e : new Error(String(e.message)), { op: 'RUN', sql });
    return { ok: false, error: e.message };
  }
}

export async function dbBatch(ctx, statements) {
  const prepared = statements.map(([sql, ...params]) =>
    ctx.db.prepare(sql).bind(...params),
  );
  return ctx.db.batch(prepared);
}
