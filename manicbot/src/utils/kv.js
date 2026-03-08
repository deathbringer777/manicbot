export async function kvListAll(ctx, opts) {
  const pLen = ctx.prefix.length;
  const prefixedOpts = opts.prefix ? { ...opts, prefix: ctx.prefix + opts.prefix } : opts;
  const keys = [];
  let cursor;
  do {
    const res = await ctx.kv.list({ ...prefixedOpts, cursor });
    for (const k of res.keys) keys.push({ ...k, name: k.name.slice(pLen) });
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return keys;
}

export async function kvGet(ctx, k) {
  try { return await ctx.kv.get(ctx.prefix + k, 'json'); }
  catch (e) { console.error('KV GET fail:', k, e.message); return null; }
}

export async function kvPut(ctx, k, v, o) {
  try { await ctx.kv.put(ctx.prefix + k, JSON.stringify(v), o); return true; }
  catch (e) { console.error('KV PUT fail:', k, e.message); return false; }
}

export async function kvDel(ctx, k) {
  try { await ctx.kv.delete(ctx.prefix + k); }
  catch (e) { console.error('KV DEL fail:', k, e.message); }
}
