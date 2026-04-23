import { log } from './logger.js';

export async function kvListAll(ctx, opts = {}) {
  const pLen = ctx.prefix.length;
  const prefix = opts.prefix != null ? ctx.prefix + opts.prefix : ctx.prefix;
  const listOpts = { ...opts, prefix };
  const keys = [];
  let cursor;
  do {
    const res = await ctx.kv.list({ ...listOpts, cursor });
    for (const k of res.keys) keys.push({ ...k, name: k.name.slice(pLen) });
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return keys;
}

export async function kvGet(ctx, k) {
  try { return await ctx.kv.get(ctx.prefix + k, 'json'); }
  catch (e) { log.error('utils.kv', e instanceof Error ? e : new Error(String(e.message)), { op: 'GET' }); return null; }
}

export async function kvPut(ctx, k, v, o) {
  try { await ctx.kv.put(ctx.prefix + k, JSON.stringify(v), o); return true; }
  catch (e) { log.error('utils.kv', e instanceof Error ? e : new Error(String(e.message)), { op: 'PUT' }); return false; }
}

export async function kvDel(ctx, k) {
  try { await ctx.kv.delete(ctx.prefix + k); }
  catch (e) { log.error('utils.kv', e instanceof Error ? e : new Error(String(e.message)), { op: 'DEL' }); }
}
