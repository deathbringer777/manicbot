import { dbGet, dbRun } from '../utils/db.js';
import { getChatHistory } from './chat.js';

export async function getHumanRequestCount(ctx, cid) {
  if (!ctx?.db || !ctx?.tenantId) return 0;
  const row = await dbGet(ctx,
    'SELECT count FROM human_requests WHERE tenant_id = ? AND chat_id = ?',
    ctx.tenantId, cid,
  );
  return row?.count || 0;
}

export async function incHumanRequestCount(ctx, cid) {
  const n = await getHumanRequestCount(ctx, cid);
  const next = n + 1;
  if (!ctx?.db || !ctx?.tenantId) return next;
  await dbRun(ctx,
    'INSERT OR REPLACE INTO human_requests (tenant_id, chat_id, count) VALUES (?, ?, ?)',
    ctx.tenantId, cid, next,
  );
  return next;
}

export async function resetHumanRequestCount(ctx, cid) {
  if (!ctx?.db || !ctx?.tenantId) return;
  await dbRun(ctx, 'DELETE FROM human_requests WHERE tenant_id = ? AND chat_id = ?', ctx.tenantId, cid);
}

export async function getTicket(ctx, clientCid) {
  if (!ctx?.db || !ctx?.tenantId) return null;
  const row = await dbGet(ctx,
    'SELECT * FROM local_tickets WHERE tenant_id = ? AND client_cid = ? AND open = 1',
    ctx.tenantId, clientCid,
  );
  if (!row) return null;
  return { open: true, masterCid: row.master_cid, ...(row.data ? JSON.parse(row.data) : {}) };
}

export async function setTicket(ctx, clientCid, data) {
  if (!ctx?.db || !ctx?.tenantId) return;
  const serialized = { ...data };
  delete serialized.open;
  delete serialized.masterCid;
  await dbRun(ctx,
    'INSERT OR REPLACE INTO local_tickets (tenant_id, client_cid, master_cid, open, data) VALUES (?, ?, ?, 1, ?)',
    ctx.tenantId, clientCid, data.masterCid || null, JSON.stringify(serialized),
  );
}

export async function getTicketMaster(ctx, masterCid) {
  if (!ctx?.db || !ctx?.tenantId) return null;
  const row = await dbGet(ctx,
    'SELECT client_cid FROM local_tickets WHERE tenant_id = ? AND master_cid = ? AND open = 1',
    ctx.tenantId, masterCid,
  );
  return row?.client_cid || null;
}

export async function setTicketMaster(ctx, masterCid, clientCid) {
  if (!ctx?.db || !ctx?.tenantId) return;
  await dbRun(ctx,
    'UPDATE local_tickets SET master_cid = ? WHERE tenant_id = ? AND client_cid = ? AND open = 1',
    masterCid, ctx.tenantId, clientCid,
  );
}

export async function clearTicket(ctx, clientCid) {
  if (!ctx?.db || !ctx?.tenantId) return;
  await dbRun(ctx,
    'UPDATE local_tickets SET open = 0 WHERE tenant_id = ? AND client_cid = ?',
    ctx.tenantId, clientCid,
  );
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
