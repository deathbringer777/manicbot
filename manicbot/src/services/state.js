import { STATE_TTL_SEC, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC } from '../config.js';
import { kvGet, kvPut, kvDel } from '../utils/kv.js';

export async function checkRateLimit(ctx, cid) {
  const key = `rl:${cid}`;
  const count = await kvGet(ctx, key);
  if (count !== null && count >= RATE_LIMIT_MAX) return false;
  await kvPut(ctx, key, (count || 0) + 1, { expirationTtl: RATE_LIMIT_WINDOW_SEC });
  return true;
}

export async function getState(ctx, cid) { return (await kvGet(ctx, `st:${cid}`)) || { step: 'idle' }; }
export async function setState(ctx, cid, s) { await kvPut(ctx, `st:${cid}`, s, { expirationTtl: STATE_TTL_SEC }); }
export async function clearState(ctx, cid) { await kvDel(ctx, `st:${cid}`); }
