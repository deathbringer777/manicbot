/**
 * Worker-side messenger threads helpers (migration 0067).
 *
 * Exercises the upsert against an in-memory D1 mock so we can verify:
 *   - First inbound creates the thread + external_client member + web_user
 *     members for all tenant staff + the inbound thread_messages row
 *   - Second inbound from the same client touches last_message_at on the
 *     SAME thread row (idempotent)
 *   - The thread is keyed by client_conversation_id, so the same channel
 *     user across two tenants produces two separate threads
 *   - lookupClientConvTarget returns the channel + channel_user_id from
 *     the linked conversations row
 *   - appendOutboundStaffMessage writes a sender_kind='system' row and
 *     bumps the thread preview
 */

import { describe, it, expect } from 'vitest';
import { createMockD1 } from './helpers/mock-db.js';
import {
  upsertClientConvThreadForInbound,
  appendOutboundStaffMessage,
  lookupClientConvTarget,
  externalClientRef,
} from '../src/services/messengerThreads.js';

function makeCtx() {
  return { db: createMockD1(), tenantId: 't_a' };
}

async function seedConversation(ctx, tenantId, channelType, channelUserId, id = 'conv_1') {
  const now = Math.floor(Date.now() / 1000);
  await ctx.db
    .prepare(
      `INSERT INTO conversations
         (id, tenant_id, channel_type, channel_user_id, status, last_message_at, created_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?)`,
    )
    .bind(id, tenantId, channelType, String(channelUserId), now, now)
    .run();
}

async function seedWebUser(ctx, id, tenantId) {
  const now = Math.floor(Date.now() / 1000);
  await ctx.db
    .prepare(
      `INSERT INTO web_users (id, email, password_hash, tenant_id, role, created_at, updated_at)
       VALUES (?, ?, '', ?, 'tenant_owner', ?, ?)`,
    )
    .bind(id, `${id}@x`, tenantId, now, now)
    .run();
}

async function countRows(ctx, table, where = '') {
  const sql = `SELECT count(*) as n FROM ${table}${where ? ' WHERE ' + where : ''}`;
  const row = await ctx.db.prepare(sql).first();
  return row?.n ?? 0;
}

describe('externalClientRef()', () => {
  it('formats as "<channel>:<userId>"', () => {
    expect(externalClientRef('telegram', 123)).toBe('telegram:123');
    expect(externalClientRef('instagram', '17841...')).toBe('instagram:17841...');
    expect(externalClientRef('whatsapp', '48123456789')).toBe('whatsapp:48123456789');
  });
});

describe('upsertClientConvThreadForInbound', () => {
  it('returns null when no conversations row exists for the user', async () => {
    const ctx = makeCtx();
    const out = await upsertClientConvThreadForInbound(ctx, {
      tenantId: 't_a',
      channelType: 'telegram',
      channelUserId: '999',
      body: 'hi',
    });
    expect(out).toBeNull();
  });

  it('first inbound creates thread + external_client member + web_user members + message row', async () => {
    const ctx = makeCtx();
    await seedConversation(ctx, 't_a', 'telegram', '500', 'conv_a');
    await seedWebUser(ctx, 'w_owner', 't_a');
    await seedWebUser(ctx, 'w_master', 't_a');

    const out = await upsertClientConvThreadForInbound(ctx, {
      tenantId: 't_a',
      channelType: 'telegram',
      channelUserId: '500',
      displayName: 'Alice',
      body: 'hello',
      externalMsgId: 'tg_msg_42',
    });

    expect(out).not.toBeNull();
    expect(out.threadId.startsWith('th_')).toBe(true);
    expect(out.messageId).toHaveLength(26); // ULID

    expect(await countRows(ctx, 'threads')).toBe(1);
    expect(await countRows(ctx, 'thread_messages')).toBe(1);

    // 1 external_client + 2 web_users
    expect(await countRows(ctx, 'thread_members')).toBe(3);
    expect(
      await countRows(ctx, 'thread_members', "member_kind = 'external_client'"),
    ).toBe(1);
    expect(
      await countRows(ctx, 'thread_members', "member_kind = 'web_user'"),
    ).toBe(2);

    const thread = await ctx.db
      .prepare(`SELECT kind, client_conversation_id, last_message_preview FROM threads LIMIT 1`)
      .first();
    expect(thread.kind).toBe('client_conv');
    expect(thread.client_conversation_id).toBe('conv_a');
    expect(thread.last_message_preview).toBe('hello');
  });

  it('second inbound from same user reuses the same thread (idempotent)', async () => {
    const ctx = makeCtx();
    await seedConversation(ctx, 't_a', 'telegram', '500', 'conv_a');
    await seedWebUser(ctx, 'w_owner', 't_a');

    const first = await upsertClientConvThreadForInbound(ctx, {
      tenantId: 't_a', channelType: 'telegram', channelUserId: '500', body: 'one',
    });
    const second = await upsertClientConvThreadForInbound(ctx, {
      tenantId: 't_a', channelType: 'telegram', channelUserId: '500', body: 'two',
    });

    expect(first.threadId).toBe(second.threadId);
    expect(await countRows(ctx, 'threads')).toBe(1);
    expect(await countRows(ctx, 'thread_messages')).toBe(2);
    // External-client member written once
    expect(
      await countRows(ctx, 'thread_members', "member_kind = 'external_client'"),
    ).toBe(1);
  });

  it('different tenants get separate threads even with same channel_user_id', async () => {
    const ctx = makeCtx();
    await seedConversation(ctx, 't_a', 'telegram', '500', 'conv_a');
    await seedConversation(ctx, 't_b', 'telegram', '500', 'conv_b');
    await seedWebUser(ctx, 'w_a', 't_a');
    await seedWebUser(ctx, 'w_b', 't_b');

    const a = await upsertClientConvThreadForInbound(ctx, {
      tenantId: 't_a', channelType: 'telegram', channelUserId: '500', body: 'A',
    });
    const b = await upsertClientConvThreadForInbound(ctx, {
      tenantId: 't_b', channelType: 'telegram', channelUserId: '500', body: 'B',
    });
    expect(a.threadId).not.toBe(b.threadId);
    expect(await countRows(ctx, 'threads')).toBe(2);
  });

  it('falls back to placeholder body when message text is empty', async () => {
    const ctx = makeCtx();
    await seedConversation(ctx, 't_a', 'instagram', '100', 'conv_x');
    await seedWebUser(ctx, 'w_owner', 't_a');

    await upsertClientConvThreadForInbound(ctx, {
      tenantId: 't_a', channelType: 'instagram', channelUserId: '100', body: '',
    });
    const m = await ctx.db.prepare(`SELECT body FROM thread_messages LIMIT 1`).first();
    expect(m.body).toBe('[медиа]');
  });
});

describe('lookupClientConvTarget', () => {
  it('returns the channel + channel_user_id for an existing client_conv thread', async () => {
    const ctx = makeCtx();
    await seedConversation(ctx, 't_a', 'whatsapp', '48999', 'conv_wa');
    await seedWebUser(ctx, 'w_owner', 't_a');
    const { threadId } = await upsertClientConvThreadForInbound(ctx, {
      tenantId: 't_a', channelType: 'whatsapp', channelUserId: '48999', body: 'hola',
    });

    const target = await lookupClientConvTarget(ctx, 't_a', threadId);
    expect(target).toEqual({
      conversationId: 'conv_wa',
      channelType: 'whatsapp',
      channelUserId: '48999',
    });
  });

  it('returns null when thread is in a different tenant', async () => {
    const ctx = makeCtx();
    await seedConversation(ctx, 't_a', 'telegram', '500', 'conv_a');
    await seedWebUser(ctx, 'w_owner', 't_a');
    const { threadId } = await upsertClientConvThreadForInbound(ctx, {
      tenantId: 't_a', channelType: 'telegram', channelUserId: '500', body: 'A',
    });
    expect(await lookupClientConvTarget(ctx, 't_b', threadId)).toBeNull();
  });

  it('returns null for a non-existent thread id', async () => {
    const ctx = makeCtx();
    expect(await lookupClientConvTarget(ctx, 't_a', 'th_missing')).toBeNull();
  });
});

describe('appendOutboundStaffMessage', () => {
  it('writes a system-relay row and bumps the thread preview', async () => {
    const ctx = makeCtx();
    await seedConversation(ctx, 't_a', 'telegram', '500', 'conv_a');
    await seedWebUser(ctx, 'w_owner', 't_a');
    const { threadId } = await upsertClientConvThreadForInbound(ctx, {
      tenantId: 't_a', channelType: 'telegram', channelUserId: '500', body: 'inbound',
    });

    const out = await appendOutboundStaffMessage(ctx, {
      tenantId: 't_a',
      threadId,
      body: 'thanks for your message',
      externalMsgId: 'tg_msg_99',
    });

    expect(out?.messageId).toHaveLength(26);
    const relayRow = await ctx.db
      .prepare(
        `SELECT sender_kind, sender_ref, external_msg_id FROM thread_messages
           WHERE id = ?`,
      )
      .bind(out.messageId)
      .first();
    expect(relayRow.sender_kind).toBe('system');
    expect(relayRow.sender_ref).toBe('channel-relay');
    expect(relayRow.external_msg_id).toBe('tg_msg_99');

    const thread = await ctx.db
      .prepare(`SELECT last_message_preview FROM threads WHERE id = ?`)
      .bind(threadId)
      .first();
    expect(thread.last_message_preview).toBe('thanks for your message');
  });

  it('refuses empty body', async () => {
    const ctx = makeCtx();
    const out = await appendOutboundStaffMessage(ctx, {
      tenantId: 't_a',
      threadId: 'th_x',
      body: '',
      externalMsgId: 'x',
    });
    expect(out).toBeNull();
  });
});
