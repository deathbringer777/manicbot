import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/dedup.js', () => ({ claimMetaMessage: vi.fn() }));
import { claimMetaMessage } from '../src/utils/dedup.js';
import { parseCommentChange, ingestComment } from '../src/channels/comment-ingest.js';

const OWNER_IG = '25881183448226493';

function makeDb() {
  const state = { inserts: [] };
  return {
    state,
    prepare: vi.fn().mockImplementation((sql) => ({
      bind: (...args) => ({
        run: async () => {
          if (/INSERT (OR IGNORE )?INTO social_comment_inbox/i.test(sql)) {
            state.inserts.push({ sql, args });
          }
          return { meta: { changes: 1 } };
        },
      }),
    })),
  };
}

const IG_CHANGE = {
  field: 'comments',
  value: {
    id: 'IGC_1',
    text: 'Ile kosztuje?',
    from: { id: '178000123', username: 'klientka' },
    media: { id: 'MEDIA_9' },
    parent_id: undefined,
  },
};

const FB_FEED_COMMENT = {
  field: 'feed',
  value: {
    item: 'comment',
    verb: 'add',
    comment_id: 'FBC_1',
    post_id: 'POST_7',
    parent_id: 'PARENT_2',
    from: { id: '99001', name: 'Jan Kowalski' },
    message: 'Super!',
  },
};

beforeEach(() => {
  claimMetaMessage.mockReset();
  claimMetaMessage.mockResolvedValue(true);
});

describe('comment-ingest — parseCommentChange', () => {
  it('parses an IG comments change', () => {
    const c = parseCommentChange('instagram', IG_CHANGE);
    expect(c).toEqual({
      commentId: 'IGC_1',
      mediaId: 'MEDIA_9',
      parentId: null,
      fromUserId: '178000123',
      fromUsername: 'klientka',
      text: 'Ile kosztuje?',
    });
  });

  it('parses an FB feed add-comment change', () => {
    const c = parseCommentChange('facebook', FB_FEED_COMMENT);
    expect(c).toEqual({
      commentId: 'FBC_1',
      mediaId: 'POST_7',
      parentId: 'PARENT_2',
      fromUserId: '99001',
      fromUsername: 'Jan Kowalski',
      text: 'Super!',
    });
  });

  it('ignores FB feed events that are not new comments (likes, removals, posts)', () => {
    expect(parseCommentChange('facebook', { field: 'feed', value: { item: 'like', verb: 'add' } })).toBeNull();
    expect(parseCommentChange('facebook', { field: 'feed', value: { item: 'comment', verb: 'remove', comment_id: 'X' } })).toBeNull();
    expect(parseCommentChange('facebook', { field: 'feed', value: { item: 'status', verb: 'add' } })).toBeNull();
  });

  it('ignores non-comment IG fields and unknown channels', () => {
    expect(parseCommentChange('instagram', { field: 'messages', value: {} })).toBeNull();
    expect(parseCommentChange('telegram', IG_CHANGE)).toBeNull();
    expect(parseCommentChange('instagram', null)).toBeNull();
  });
});

describe('comment-ingest — ingestComment', () => {
  it('inserts a new IG comment as status=new', async () => {
    const db = makeDb();
    const res = await ingestComment(
      { DB: db, MANICBOT: {} },
      { tenantId: 't_x', channelType: 'instagram', pageId: 'PAGE', ownerId: OWNER_IG, change: IG_CHANGE, nowMs: 1_700_000_000_000 },
    );
    expect(res.ingested).toBe(true);
    expect(db.state.inserts).toHaveLength(1);
    const { args } = db.state.inserts[0];
    expect(args[0]).toBe('sci_IGC_1');         // id
    expect(args[1]).toBe('t_x');               // tenant_id
    expect(args[2]).toBe('instagram');         // channel_type
    expect(args[4]).toBe('IGC_1');             // comment_id
    expect(claimMetaMessage).toHaveBeenCalledWith({ MANICBOT: {}, DB: db }, 'PAGE', 'comment:IGC_1');
  });

  it('skips comments authored by our own account', async () => {
    const db = makeDb();
    const ownChange = { field: 'comments', value: { id: 'C2', from: { id: OWNER_IG }, text: 'our reply' } };
    const res = await ingestComment(
      { DB: db, MANICBOT: {} },
      { channelType: 'instagram', pageId: 'PAGE', ownerId: OWNER_IG, change: ownChange },
    );
    expect(res).toEqual({ ingested: false, reason: 'own_comment' });
    expect(db.state.inserts).toHaveLength(0);
    expect(claimMetaMessage).not.toHaveBeenCalled();
  });

  it('skips duplicates (claimMetaMessage returns false)', async () => {
    claimMetaMessage.mockResolvedValue(false);
    const db = makeDb();
    const res = await ingestComment(
      { DB: db, MANICBOT: {} },
      { channelType: 'instagram', pageId: 'PAGE', ownerId: OWNER_IG, change: IG_CHANGE },
    );
    expect(res).toEqual({ ingested: false, reason: 'duplicate' });
    expect(db.state.inserts).toHaveLength(0);
  });

  it('returns unparseable for non-comment changes without touching DB', async () => {
    const db = makeDb();
    const res = await ingestComment(
      { DB: db, MANICBOT: {} },
      { channelType: 'instagram', pageId: 'PAGE', change: { field: 'messages', value: {} } },
    );
    expect(res).toEqual({ ingested: false, reason: 'unparseable' });
    expect(claimMetaMessage).not.toHaveBeenCalled();
    expect(db.state.inserts).toHaveLength(0);
  });
});
