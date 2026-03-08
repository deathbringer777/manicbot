import { CHAT_HISTORY_MAX, CHAT_HISTORY_TTL, VALID_LANGS } from '../config.js';
import { kvGet, kvPut, kvDel } from '../utils/kv.js';

export async function getChatHistory(ctx, cid) {
  if (!ctx.kv) return [];
  const raw = await kvGet(ctx, `chat:${cid}`);
  if (!Array.isArray(raw)) return [];
  return raw.slice(-CHAT_HISTORY_MAX);
}

export async function appendChatTurn(ctx, cid, userMsg, assistantMsg) {
  if (!ctx.kv || !userMsg) return;
  const hist = await getChatHistory(ctx, cid);
  hist.push({ role: 'user', content: String(userMsg).slice(0, 300) });
  if (assistantMsg) hist.push({ role: 'assistant', content: String(assistantMsg).slice(0, 500) });
  const trimmed = hist.slice(-CHAT_HISTORY_MAX);
  await kvPut(ctx, `chat:${cid}`, trimmed, { expirationTtl: CHAT_HISTORY_TTL });
}

export async function clearChatHistory(ctx, cid) {
  if (!ctx.kv) return;
  await kvDel(ctx, `chat:${cid}`);
}

export async function getLang(ctx, cid) {
  try { return (await ctx.kv.get(`${ctx.prefix}lang:${cid}`)) || null; }
  catch { return null; }
}

export async function setLang(ctx, cid, lang) {
  if (!VALID_LANGS.has(lang)) return;
  try { await ctx.kv.put(`${ctx.prefix}lang:${cid}`, lang); } catch {}
}
