import { kvGet, kvPut } from '../utils/kv.js';
import { getChatHistory } from './chat.js';

export async function getHumanRequestCount(ctx, cid) {
  const v = await kvGet(ctx, `hr:${cid}`);
  return typeof v === 'number' && v >= 0 ? v : 0;
}

export async function incHumanRequestCount(ctx, cid) {
  const n = await getHumanRequestCount(ctx, cid);
  const next = n + 1;
  await kvPut(ctx, `hr:${cid}`, next);
  return next;
}

export async function resetHumanRequestCount(ctx, cid) {
  try { await ctx.kv.delete(ctx.prefix + `hr:${cid}`); } catch (_) {}
}

export async function getTicket(ctx, clientCid) {
  const v = await kvGet(ctx, `ticket:${clientCid}`);
  return v && v.open ? v : null;
}

export async function setTicket(ctx, clientCid, data) {
  await kvPut(ctx, `ticket:${clientCid}`, data);
}

export async function getTicketMaster(ctx, masterCid) {
  const v = await kvGet(ctx, `ticket_master:${masterCid}`);
  return typeof v === 'number' ? v : null;
}

export async function setTicketMaster(ctx, masterCid, clientCid) {
  await kvPut(ctx, `ticket_master:${masterCid}`, clientCid);
}

export async function clearTicket(ctx, clientCid) {
  const ticket = await getTicket(ctx, clientCid);
  if (ticket?.masterCid) {
    try { await ctx.kv.delete(ctx.prefix + `ticket_master:${ticket.masterCid}`); } catch (_) {}
  }
  try { await ctx.kv.delete(ctx.prefix + `ticket:${clientCid}`); } catch (_) {}
}

export function isTicketCloseWord(txt) {
  if (!txt || typeof txt !== 'string') return false;
  const u = txt.trim().toUpperCase();
  return u === 'STOP' || u === 'СТОП';
}

export async function buildTicketInternalNote(ctx, clientCid) {
  const hist = await getChatHistory(ctx, clientCid);
  if (!hist || hist.length === 0) return null;
  const lines = [];
  for (const m of hist) {
    const role = m.role === 'user' ? '👤' : '🤖';
    const content = (m.content || '').trim().slice(0, 200);
    if (content) lines.push(`${role} ${content}`);
  }
  if (lines.length === 0) return null;
  return lines.join('\n').slice(0, 1500);
}
