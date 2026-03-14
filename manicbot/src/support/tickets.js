/**
 * Platform support tickets: create, claim, list, message routing.
 * Global keys: ticket:{ticketId}, tickets:open, tickets:agent:{chatId}.
 * Tenant index: t:{tenantId}:tickets:client:{chatId} (array of ticketIds).
 */

import { randomId } from '../utils/security.js';

const TICKET_PREFIX = 'ticket:';
const TICKETS_OPEN = 'tickets:open';
const TICKETS_AGENT_PREFIX = 'tickets:agent:';
const TKT_LOCK_PREFIX = 'tktlock:';
const LOCK_TTL = 10;

function ticketKey(id) { return TICKET_PREFIX + id; }
function agentKey(chatId) { return TICKETS_AGENT_PREFIX + chatId; }

export async function createTicket(globalKv, ctx, clientChatId, clientName, clientBotId, firstMessage) {
  if (!globalKv || !clientChatId) return null;
  const tenantId = ctx?.tenantId || ctx?.bot?.botId || 'legacy';
  const id = 'tk_' + randomId(8);
  const ticket = {
    id,
    tenantId,
    clientChatId,
    clientBotId: clientBotId || null,
    clientName: clientName || 'Client',
    status: 'open',
    claimedBy: null,
    claimedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [{ from: 'client', text: firstMessage, at: Date.now() }],
  };
  await globalKv.put(ticketKey(id), JSON.stringify(ticket));
  const openList = await getOpenTicketIds(globalKv);
  if (!openList.includes(id)) {
    openList.push(id);
    await globalKv.put(TICKETS_OPEN, JSON.stringify(openList));
  }
  if (ctx.kv && ctx.prefix) {
    const clientList = await getJson(ctx.kv, ctx.prefix + 'tickets:client:' + clientChatId);
    const newList = [...(Array.isArray(clientList) ? clientList : []), id];
    try {
      await ctx.kv.put(ctx.prefix + 'tickets:client:' + clientChatId, JSON.stringify(newList));
    } catch (e) { console.error('tickets client index:', e.message); }
  }
  return ticket;
}

async function getJson(kv, key) {
  try {
    const raw = await kv.get(key, 'json');
    return raw;
  } catch { return null; }
}

export async function getOpenTicketIds(globalKv) {
  const raw = await getJson(globalKv, TICKETS_OPEN);
  return Array.isArray(raw) ? raw : [];
}

export async function getTicketById(globalKv, ticketId) {
  return await getJson(globalKv, ticketKey(ticketId));
}

export async function claimTicket(globalKv, ticketId, agentChatId) {
  if (!globalKv || !ticketId || !agentChatId) return { ok: false, error: 'Missing params' };
  const lockKey = TKT_LOCK_PREFIX + ticketId;
  try {
    await globalKv.put(lockKey, String(agentChatId), { expirationTtl: LOCK_TTL });
  } catch (e) { return { ok: false, error: 'Lock failed' }; }
  const ticket = await getTicketById(globalKv, ticketId);
  if (!ticket || ticket.status !== 'open') {
    return { ok: false, error: 'Ticket not open' };
  }
  const lockOwner = await globalKv.get(lockKey, 'text');
  if (lockOwner !== String(agentChatId)) {
    return { ok: false, error: 'Claim race lost' };
  }
  ticket.status = 'claimed';
  ticket.claimedBy = agentChatId;
  ticket.claimedAt = Date.now();
  ticket.updatedAt = Date.now();
  await globalKv.put(ticketKey(ticketId), JSON.stringify(ticket));
  // Final lock check: another worker may have written between our check and this write
  const finalLock = await globalKv.get(lockKey, 'text');
  if (finalLock !== String(agentChatId)) {
    // Race lost after claim write — roll back to open
    ticket.status = 'open';
    ticket.claimedBy = null;
    ticket.claimedAt = null;
    await globalKv.put(ticketKey(ticketId), JSON.stringify(ticket));
    return { ok: false, error: 'Claim race lost' };
  }
  const openList = (await getOpenTicketIds(globalKv)).filter(id => id !== ticketId);
  await globalKv.put(TICKETS_OPEN, JSON.stringify(openList));
  const agentList = await getJson(globalKv, agentKey(agentChatId)) || [];
  if (!agentList.includes(ticketId)) {
    agentList.push(ticketId);
    await globalKv.put(agentKey(agentChatId), JSON.stringify(agentList));
  }
  return { ok: true, ticket };
}

export async function getAgentTicketIds(globalKv, agentChatId) {
  const raw = await getJson(globalKv, agentKey(agentChatId));
  return Array.isArray(raw) ? raw : [];
}

export async function appendMessage(globalKv, ticketId, from, text) {
  const ticket = await getTicketById(globalKv, ticketId);
  if (!ticket) return false;
  ticket.messages = ticket.messages || [];
  ticket.messages.push({ from, text, at: Date.now() });
  ticket.updatedAt = Date.now();
  await globalKv.put(ticketKey(ticketId), JSON.stringify(ticket));
  return true;
}

export async function closeTicket(globalKv, ticketId) {
  const ticket = await getTicketById(globalKv, ticketId);
  if (!ticket) return false;
  ticket.status = 'closed';
  ticket.updatedAt = Date.now();
  await globalKv.put(ticketKey(ticketId), JSON.stringify(ticket));
  const openList = (await getOpenTicketIds(globalKv)).filter(id => id !== ticketId);
  await globalKv.put(TICKETS_OPEN, JSON.stringify(openList));
  if (ticket.claimedBy) {
    const agentList = (await getJson(globalKv, agentKey(ticket.claimedBy)) || []).filter(id => id !== ticketId);
    await globalKv.put(agentKey(ticket.claimedBy), JSON.stringify(agentList));
  }
  return true;
}
