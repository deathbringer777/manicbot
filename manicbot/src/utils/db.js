/**
 * D1 helper layer — thin wrappers around ctx.db (Cloudflare D1 binding).
 * Mirrors the kvGet/kvPut pattern: catch on SELECT, throw on mutations.
 */

export async function dbGet(ctx, sql, ...params) {
  try {
    const result = await ctx.db.prepare(sql).bind(...params).first();
    return result || null;
  } catch (e) {
    console.error('D1 GET fail:', sql, e.message);
    return null;
  }
}

export async function dbAll(ctx, sql, ...params) {
  try {
    const result = await ctx.db.prepare(sql).bind(...params).all();
    return result.results || [];
  } catch (e) {
    console.error('D1 ALL fail:', sql, e.message);
    return [];
  }
}

export async function dbRun(ctx, sql, ...params) {
  const result = await ctx.db.prepare(sql).bind(...params).run();
  return result;
}

export async function dbBatch(ctx, statements) {
  const prepared = statements.map(([sql, ...params]) =>
    ctx.db.prepare(sql).bind(...params),
  );
  return ctx.db.batch(prepared);
}
