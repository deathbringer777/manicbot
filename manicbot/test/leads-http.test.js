import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn(async () => {}) }));

import { tryLeadRoutes } from '../src/http/leadsHttp.js';

function makeEnv() {
  const rows = [];
  const rateLimitStore = new Map();
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...params) {
            const run = async () => {
              if (sql.includes('INSERT INTO leads')) rows.push({ table: 'leads', params });
              else if (sql.includes('INSERT INTO email_subscribers')) rows.push({ table: 'subs', params });
              else if (sql.includes('rate_limits')) {
                const [key, action, count, windowStart] = params;
                rateLimitStore.set(`${key}|${action}`, { count, window_start: windowStart });
              }
              return { success: true };
            };
            const first = async () => {
              if (sql.includes('rate_limits')) {
                const [key, action] = params;
                return rateLimitStore.get(`${key}|${action}`) || null;
              }
              return null;
            };
            return { run, first };
          },
        };
      },
    },
  };
  return { env, rows, rateLimitStore };
}

function reqJson(path, body, ip = '1.2.3.4') {
  return new Request(`https://manicbot.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, 'User-Agent': 'jsdom' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/leads', () => {
  let env, rows;
  beforeEach(() => { ({ env, rows } = makeEnv()); });

  it('inserts a valid lead and returns 200 ok', async () => {
    const req = reqJson('/api/leads', {
      name: 'Anna', email: 'anna@salon.pl', phone: '+48501234567',
      salon_type: 'nail', masters_count: 3, note: 'Looking at Pro plan',
    });
    const res = await tryLeadRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(rows.filter(r => r.table === 'leads')).toHaveLength(1);
  });

  it('rejects missing fields with 400', async () => {
    const req = reqJson('/api/leads', { name: 'x', email: 'no-at-sign', phone: '+48' });
    const res = await tryLeadRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(400);
    expect(rows.filter(r => r.table === 'leads')).toHaveLength(0);
  });

  it('silently accepts honeypot-filled bot requests (no insert)', async () => {
    const req = reqJson('/api/leads', {
      name: 'Bot', email: 'bot@x.com', phone: '+48501234567',
      company_name_hp: 'spam',
    });
    const res = await tryLeadRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(200); // silent ok
    expect(rows.filter(r => r.table === 'leads')).toHaveLength(0);
  });

  it('normalizes unknown salon_type to "other"', async () => {
    const req = reqJson('/api/leads', {
      name: 'Anna', email: 'a@b.com', phone: '+48501234567',
      salon_type: 'spa-resort-foo',
    });
    const res = await tryLeadRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    expect(rows[0].params[3]).toBe('other');
  });

  it('rate-limits after 3 leads from the same IP in an hour', async () => {
    for (let i = 0; i < 3; i++) {
      const req = reqJson('/api/leads', {
        name: 'Anna' + i, email: `a${i}@b.com`, phone: '+48501234567',
      }, '9.9.9.9');
      const r = await tryLeadRoutes(req, env, new URL(req.url));
      expect(r.status, `call ${i}`).toBe(200);
    }
    const req = reqJson('/api/leads', {
      name: 'Anna4', email: 'a4@b.com', phone: '+48501234567',
    }, '9.9.9.9');
    const r = await tryLeadRoutes(req, env, new URL(req.url));
    expect(r.status).toBe(429);
  });

  it('notifies admin via Telegram when BOT_TOKEN and ADMIN_CHAT_ID are set', async () => {
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response('{"ok":true}', { status: 200 });
    });
    try {
      env.BOT_TOKEN = 'TESTTOKEN';
      env.ADMIN_CHAT_ID = '777';
      const req = reqJson('/api/leads', {
        name: 'Anna', email: 'a@b.com', phone: '+48501234567', note: 'hi',
      });
      const res = await tryLeadRoutes(req, env, new URL(req.url));
      expect(res.status).toBe(200);
      // notifyAdmin is fire-and-forget — wait a microtask
      await new Promise((r) => setTimeout(r, 10));
      const tgCall = calls.find(c => c.url.includes('api.telegram.org/botTESTTOKEN/sendMessage'));
      expect(tgCall).toBeDefined();
      const body = JSON.parse(tgCall.init.body);
      expect(body.chat_id).toBe('777');
      expect(body.text).toContain('Anna');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('skips TG notification when BOT_TOKEN missing', async () => {
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => { calls.push(String(url)); return new Response('{}', { status: 200 }); });
    try {
      const req = reqJson('/api/leads', {
        name: 'Anna', email: 'a@b.com', phone: '+48501234567',
      });
      await tryLeadRoutes(req, env, new URL(req.url));
      await new Promise((r) => setTimeout(r, 10));
      expect(calls.some(u => u.includes('api.telegram.org'))).toBe(false);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('responds to OPTIONS preflight', async () => {
    const req = new Request('https://manicbot.com/api/leads', { method: 'OPTIONS' });
    const res = await tryLeadRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('POST /api/email-subscribe', () => {
  let env, rows;
  beforeEach(() => { ({ env, rows } = makeEnv()); });

  it('inserts a valid subscriber', async () => {
    const req = reqJson('/api/email-subscribe', { email: 'news@test.com', locale: 'ru' });
    const res = await tryLeadRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    expect(rows.filter(r => r.table === 'subs')).toHaveLength(1);
    expect(rows[0].params[1]).toBe('ru');
  });

  it('rejects invalid email with 400', async () => {
    const req = reqJson('/api/email-subscribe', { email: 'no-at', locale: 'ru' });
    const res = await tryLeadRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it('falls back to locale=ru for unknown locales', async () => {
    const req = reqJson('/api/email-subscribe', { email: 'a@b.com', locale: 'xx-rogue' });
    const res = await tryLeadRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    expect(rows[0].params[1]).toBe('ru');
  });

  it('rate-limits after 5 requests per IP per hour', async () => {
    for (let i = 0; i < 5; i++) {
      const req = reqJson('/api/email-subscribe', { email: `x${i}@y.com` }, '7.7.7.7');
      const r = await tryLeadRoutes(req, env, new URL(req.url));
      expect(r.status).toBe(200);
    }
    const req = reqJson('/api/email-subscribe', { email: 'x5@y.com' }, '7.7.7.7');
    const r = await tryLeadRoutes(req, env, new URL(req.url));
    expect(r.status).toBe(429);
  });
});

describe('unknown path', () => {
  it('returns null so other handlers get a chance', async () => {
    const { env } = makeEnv();
    const req = reqJson('/api/other', {});
    const res = await tryLeadRoutes(req, env, new URL(req.url));
    expect(res).toBeNull();
  });
});
