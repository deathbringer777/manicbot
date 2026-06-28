import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/channels/comment-reply.js', () => ({ postCommentReply: vi.fn() }));
vi.mock('../../src/channels/resolver.js', () => ({ getChannelConfig: vi.fn() }));
import { postCommentReply } from '../../src/channels/comment-reply.js';
import { getChannelConfig } from '../../src/channels/resolver.js';
import { phaseSocialCommentReply } from '../../src/marketing/social-comments.js';

function makeDb({ drafted = [], hourlyCount = 0 } = {}) {
  const state = { updates: [], selects: [] };
  return {
    state,
    prepare: vi.fn().mockImplementation((sql) => ({
      bind: (...args) => ({
        all: async () => {
          state.selects.push(sql);
          if (/status\s*=\s*'drafted'/i.test(sql) && /SELECT/i.test(sql)) return { results: drafted };
          return { results: [] };
        },
        first: async () => {
          if (/COUNT\(\*\)/i.test(sql)) return { n: hourlyCount };
          return null;
        },
        run: async () => {
          if (/^UPDATE social_comment_inbox/i.test(sql.trim())) state.updates.push({ sql, args });
          return { meta: { changes: 1 } };
        },
      }),
    })),
  };
}

function makeEnv(db, overrides = {}) {
  return {
    DB: db,
    SOCIAL_COMMENTS_AUTOREPLY_ENABLED: '1',
    BOT_ENCRYPTION_KEY: 'x'.repeat(32),
    MARKETING_IG_TENANT_ID: 't_mb_ig',
    MARKETING_FB_TENANT_ID: 't_mb_fb',
    ...overrides,
  };
}

beforeEach(() => {
  postCommentReply.mockReset();
  getChannelConfig.mockReset();
  getChannelConfig.mockResolvedValue({ token: 'IGAA-tok' });
});
afterEach(() => vi.restoreAllMocks());

describe('marketing/social-comments — phaseSocialCommentReply', () => {
  it('skips entirely when kill-switch is off', async () => {
    const db = makeDb({ drafted: [{ id: 'sci_1' }] });
    const r = await phaseSocialCommentReply(makeEnv(db, { SOCIAL_COMMENTS_AUTOREPLY_ENABLED: '0' }));
    expect(r.skipped).toBe('disabled');
    expect(db.prepare).not.toHaveBeenCalled();
    expect(postCommentReply).not.toHaveBeenCalled();
  });

  it('posts a drafted reply and marks it replied with reply_comment_id', async () => {
    postCommentReply.mockResolvedValue({ ok: true, replyId: 'R_99' });
    const db = makeDb({
      drafted: [{ id: 'sci_1', channel_type: 'instagram', tenant_id: null, comment_id: 'IGC_1', reply_text: 'Dzięki!' }],
    });
    const r = await phaseSocialCommentReply(makeEnv(db), 1_700_000_000_000);

    expect(postCommentReply).toHaveBeenCalledWith(
      expect.objectContaining({ channelType: 'instagram', commentId: 'IGC_1', message: 'Dzięki!', token: 'IGAA-tok' }),
    );
    const upd = db.state.updates.find((u) => /status\s*=\s*'replied'/i.test(u.sql));
    expect(upd).toBeTruthy();
    expect(upd.args).toContain('R_99');
    expect(upd.args).toContain('sci_1');
    expect(r.replied).toBe(1);
  });

  it('respects the hourly rate limit (no posting when cap reached)', async () => {
    postCommentReply.mockResolvedValue({ ok: true, replyId: 'R' });
    const db = makeDb({
      drafted: [{ id: 'sci_1', channel_type: 'instagram', tenant_id: null, comment_id: 'C', reply_text: 'x' }],
      hourlyCount: 1000,
    });
    const r = await phaseSocialCommentReply(makeEnv(db));
    expect(postCommentReply).not.toHaveBeenCalled();
    expect(r.skipped).toBe('rate_limited');
  });

  it('marks a row failed when the reply errors', async () => {
    postCommentReply.mockResolvedValue({ ok: false, error: 'boom', tokenDead: true });
    const db = makeDb({
      drafted: [{ id: 'sci_2', channel_type: 'instagram', tenant_id: null, comment_id: 'C2', reply_text: 'x' }],
    });
    await phaseSocialCommentReply(makeEnv(db));
    const upd = db.state.updates.find((u) => /status\s*=\s*'failed'/i.test(u.sql));
    expect(upd).toBeTruthy();
    expect(upd.args).toContain('sci_2');
  });

  it('skips a row when no token can be resolved', async () => {
    getChannelConfig.mockResolvedValue({ token: null });
    const db = makeDb({
      drafted: [{ id: 'sci_3', channel_type: 'facebook', tenant_id: null, comment_id: 'C3', reply_text: 'x' }],
    });
    const r = await phaseSocialCommentReply(makeEnv(db));
    expect(postCommentReply).not.toHaveBeenCalled();
    expect(r.replied).toBe(0);
  });

  it('caps work per tick via SQL LIMIT', async () => {
    const db = makeDb({ drafted: [] });
    await phaseSocialCommentReply(makeEnv(db));
    const sel = db.prepare.mock.calls.map((c) => c[0]).find((s) => /status\s*=\s*'drafted'/i.test(s) && /SELECT/i.test(s));
    expect(sel).toMatch(/LIMIT/i);
  });
});
