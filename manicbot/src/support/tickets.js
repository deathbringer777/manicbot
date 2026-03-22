/**
 * Platform support tickets — D1 backed.
 * Tables: platform_tickets, platform_ticket_messages.
 * KV stays for: tktlock:{ticketId} (TTL 10s distributed lock).
 */

import { randomId } from '../utils/security.js';
import { dbGet, dbAll, dbRun, dbBatch } from '../utils/db.js';

const TKT_LOCK_PREFIX = 'tktlock:';
const LOCK_TTL = 10;

export async function createTicket(ctx, clientChatId, clientName, clientBotId, firstMessage) {
  if (!ctx?.db || !clientChatId) return null;
  const tenantId = ctx?.tenantId || ctx?.bot?.botId || 'legacy';
  const id = 'tk_' + randomId(8);
  const now = Date.now();

  await dbRun(ctx,
    `INSERT INTO platform_tickets (id, tenant_id, client_chat_id, client_bot_id, client_name, status, claimed_by, claimed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'open', NULL, NULL, ?, ?)`,
    id, tenantId, clientChatId, clientBotId || null, clientName || 'Client', now, now,
  );
  await dbRun(ctx,
    'INSERT INTO platform_ticket_messages (ticket_id, sender, text, created_at) VALUES (?, ?, ?, ?)',
    id, 'client', firstMessage, now,
  );

  return {
    id,
    tenantId,
    clientChatId,
    clientBotId: clientBotId || null,
    clientName: clientName || 'Client',
    status: 'open',
    claimedBy: null,
    claimedAt: null,
    createdAt: now,
    updatedAt: now,
    messages: [{ from: 'client', text: firstMessage, at: now }],
  };
}

function ticketRowToDoc(row, messages = []) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clientChatId: row.client_chat_id,
    clientBotId: row.client_bot_id,
    clientName: row.client_name,
    status: row.status,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: messages.map(m => ({ from: m.sender, text: m.text, at: m.created_at })),
  };
}

export async function getOpenTicketIds(ctx) {
  if (!ctx?.db) return [];
  const rows = await dbAll(ctx, "SELECT id FROM platform_tickets WHERE status = 'open'");
  return rows.map(r => r.id);
}

export async function getTicketById(ctx, ticketId) {
  if (!ctx?.db) return null;
  const row = await dbGet(ctx, 'SELECT * FROM platform_tickets WHERE id = ?', ticketId);
  if (!row) return null;
  const msgs = await dbAll(ctx,
    'SELECT * FROM platform_ticket_messages WHERE ticket_id = ? ORDER BY created_at',
    ticketId,
  );
  return ticketRowToDoc(row, msgs);
}

export async function claimTicket(ctx, ticketId, agentChatId) {
  if (!ctx?.db || !ticketId || !agentChatId) return { ok: false, error: 'Missing params' };
  const kv = ctx.kv || ctx.globalKv;
  const lockKey = TKT_LOCK_PREFIX + ticketId;
  if (kv) {
    try {
      await kv.put(lockKey, String(agentChatId), { expirationTtl: LOCK_TTL });
    } catch (e) { return { ok: false, error: 'Lock failed' }; }
  }
  const ticket = await getTicketById(ctx, ticketId);
  if (!ticket || ticket.status !== 'open') {
    return { ok: false, error: 'Ticket not open' };
  }
  if (kv) {
    const lockOwner = await kv.get(lockKey, 'text');
    if (lockOwner !== String(agentChatId)) {
      return { ok: false, error: 'Claim race lost' };
    }
  }
  const now = Date.now();
  await dbRun(ctx,
    "UPDATE platform_tickets SET status = 'claimed', claimed_by = ?, claimed_at = ?, updated_at = ? WHERE id = ?",
    agentChatId, now, now, ticketId,
  );
  if (kv) {
    const finalLock = await kv.get(lockKey, 'text');
    if (finalLock !== String(agentChatId)) {
      await dbRun(ctx,
        "UPDATE platform_tickets SET status = 'open', claimed_by = NULL, claimed_at = NULL, updated_at = ? WHERE id = ?",
        Date.now(), ticketId,
      );
      return { ok: false, error: 'Claim race lost' };
    }
  }
  ticket.status = 'claimed';
  ticket.claimedBy = agentChatId;
  ticket.claimedAt = now;
  ticket.updatedAt = now;
  return { ok: true, ticket };
}

export async function getAgentTicketIds(ctx, agentChatId) {
  if (!ctx?.db) return [];
  const rows = await dbAll(ctx,
    "SELECT id FROM platform_tickets WHERE claimed_by = ? AND status = 'claimed'",
    agentChatId,
  );
  return rows.map(r => r.id);
}

export async function appendMessage(ctx, ticketId, from, text) {
  if (!ctx?.db) return false;
  const ticket = await dbGet(ctx, 'SELECT id FROM platform_tickets WHERE id = ?', ticketId);
  if (!ticket) return false;
  await dbRun(ctx,
    'INSERT INTO platform_ticket_messages (ticket_id, sender, text, created_at) VALUES (?, ?, ?, ?)',
    ticketId, from, text, Date.now(),
  );
  await dbRun(ctx,
    'UPDATE platform_tickets SET updated_at = ? WHERE id = ?',
    Date.now(), ticketId,
  );
  return true;
}

export async function closeTicket(ctx, ticketId) {
  if (!ctx?.db) return false;
  const ticket = await dbGet(ctx, 'SELECT id FROM platform_tickets WHERE id = ?', ticketId);
  if (!ticket) return false;
  await dbRun(ctx,
    "UPDATE platform_tickets SET status = 'closed', updated_at = ? WHERE id = ?",
    Date.now(), ticketId,
  );
  return true;
}
