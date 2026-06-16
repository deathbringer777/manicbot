/**
 * /r/<token> redirect endpoint tests — valid token 302s to the signed
 * destination (with mc attribution) and logs a click; forged/unconfigured →
 * 404 with no click row written.
 */
import { describe, it, expect } from 'vitest';
import { handleClickRedirect } from '../src/http/clickRedirectHttp.js';
import { signClickToken } from '../src/services/marketing/clickToken.js';
import { createMockD1 } from './helpers/mock-db.js';

const SECRET = 'redirect-secret-which-is-long-enough';

async function clickRows(db) {
  const r = await db.prepare('SELECT * FROM marketing_link_clicks').all();
  return r.results ?? [];
}

describe('handleClickRedirect', () => {
  it('302s to the destination with mc param and logs a click', async () => {
    const env = { CLICK_TOKEN_SECRET: SECRET, DB: createMockD1() };
    const tok = await signClickToken(SECRET, {
      campaignId: 'cmp_1', sendId: 'snd_9', tenantId: 't_a',
      contactId: 5, url: 'https://salon.example/book',
    });
    const res = await handleClickRedirect(new Request(`https://manicbot.com/r/${tok}`), tok, env);

    expect(res.status).toBe(302);
    const loc = res.headers.get('Location');
    expect(loc).toContain('https://salon.example/book');
    expect(loc).toContain('mc=snd_9');

    const rows = await clickRows(env.DB);
    expect(rows.length).toBe(1);
    expect(rows[0].campaign_id).toBe('cmp_1');
    expect(rows[0].tenant_id).toBe('t_a');
  });

  it('404s on a forged/invalid token and writes no click', async () => {
    const env = { CLICK_TOKEN_SECRET: SECRET, DB: createMockD1() };
    const res = await handleClickRedirect(new Request('https://manicbot.com/r/bad'), 'bad', env);
    expect(res.status).toBe(404);
    expect((await clickRows(env.DB)).length).toBe(0);
  });

  it('404s when no secret is configured', async () => {
    const res = await handleClickRedirect(new Request('https://x/r/t'), 't', { DB: createMockD1() });
    expect(res.status).toBe(404);
  });
});
