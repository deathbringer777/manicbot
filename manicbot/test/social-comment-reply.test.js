import { describe, it, expect, vi, afterEach } from 'vitest';
import { replyToIgComment, replyToFbComment, postCommentReply } from '../src/channels/comment-reply.js';

const IGAA = 'IGAA-token'; // → graph.instagram.com
const EAA = 'EAA-token';   // → graph.facebook.com

function makeFetchResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('comment-reply — replyToIgComment', () => {
  it('POSTs /{commentId}/replies with message, returns replyId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { id: 'REPLY_1' }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await replyToIgComment({ commentId: 'IGC_1', message: 'Dziękujemy!', token: IGAA });
    expect(res).toEqual({ ok: true, replyId: 'REPLY_1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.instagram.com/v21.0/IGC_1/replies');
    expect(JSON.parse(init.body).message).toBe('Dziękujemy!');
  });

  it('rejects missing inputs without calling Meta', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await replyToIgComment({ commentId: '', message: 'x', token: IGAA })).ok).toBe(false);
    expect((await replyToIgComment({ commentId: 'C', message: '', token: IGAA })).ok).toBe(false);
    expect((await replyToIgComment({ commentId: 'C', message: 'x', token: '' })).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces token-dead', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeFetchResponse(401, { error: { code: 190, type: 'OAuthException', message: 'bad' } }),
    ));
    const res = await replyToIgComment({ commentId: 'C', message: 'x', token: IGAA });
    expect(res.ok).toBe(false);
    expect(res.tokenDead).toBe(true);
  });
});

describe('comment-reply — replyToFbComment', () => {
  it('POSTs /{commentId}/comments with message on graph.facebook.com', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { id: 'FBR_1' }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await replyToFbComment({ commentId: 'FBC_1', message: 'Cześć!', token: EAA });
    expect(res).toEqual({ ok: true, replyId: 'FBR_1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/FBC_1/comments');
    expect(JSON.parse(init.body).message).toBe('Cześć!');
  });

  it('returns ok:false when Meta omits id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(200, { weird: 1 })));
    const res = await replyToFbComment({ commentId: 'C', message: 'x', token: EAA });
    expect(res.ok).toBe(false);
  });
});

describe('comment-reply — postCommentReply dispatch', () => {
  it('routes instagram → replies edge', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { id: 'R' }));
    vi.stubGlobal('fetch', fetchMock);
    await postCommentReply({ channelType: 'instagram', commentId: 'C', message: 'x', token: IGAA });
    expect(fetchMock.mock.calls[0][0]).toContain('/C/replies');
  });

  it('routes facebook → comments edge', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { id: 'R' }));
    vi.stubGlobal('fetch', fetchMock);
    await postCommentReply({ channelType: 'facebook', commentId: 'C', message: 'x', token: EAA });
    expect(fetchMock.mock.calls[0][0]).toContain('/C/comments');
  });

  it('rejects unknown channel', async () => {
    const res = await postCommentReply({ channelType: 'telegram', commentId: 'C', message: 'x', token: 'z' });
    expect(res.ok).toBe(false);
  });
});
