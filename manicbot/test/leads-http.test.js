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
              if (sql.includes('SELECT COUNT(*)') && sql.includes('FROM leads')) {
                const [emailParam] = params;
                const count = rows.filter(r => r.table === 'leads' && r.params[1] === emailParam).length;
                return { n: count };
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

  it('rate-limits only after 30 leads from the same IP in an hour', async () => {
    for (let i = 0; i < 30; i++) {
      const req = reqJson('/api/leads', {
        name: 'Anna' + i, email: `a${i}@b.com`, phone: '+48501234567',
      }, '9.9.9.9');
      const r = await tryLeadRoutes(req, env, new URL(req.url));
      expect(r.status, `call ${i}`).toBe(200);
    }
    const req = reqJson('/api/leads', {
      name: 'Anna31', email: 'a31@b.com', phone: '+48501234567',
    }, '9.9.9.9');
    const r = await tryLeadRoutes(req, env, new URL(req.url));
    expect(r.status).toBe(429);
  });

  it('creates a new leads row AND upserts marketing_contacts on every submission', async () => {
    const makeMockEnv = () => {
      const leadRows = [];
      const contactRows = new Map(); // email → { name, phone, lead_count, ... }
      return {
        rows: { leads: leadRows, contacts: contactRows },
        env: {
          DB: {
            prepare(sql) {
              return {
                bind(...params) {
                  return {
                    run: async () => {
                      if (sql.includes('INSERT INTO leads')) {
                        leadRows.push(params);
                      } else if (sql.includes('INSERT INTO marketing_contacts')) {
                        const [email, name, phone, , firstSeen, lastSeen] = params;
                        const existing = contactRows.get(email);
                        if (existing) {
                          existing.name = name;
                          existing.phone = phone;
                          existing.last_seen_at = lastSeen;
                          existing.lead_count += 1;
                        } else {
                          contactRows.set(email, {
                            email, name, phone,
                            first_seen_at: firstSeen, last_seen_at: lastSeen,
                            lead_count: 1,
                          });
                        }
                      } else if (sql.includes('rate_limits')) { /* ignore */ }
                      return { success: true };
                    },
                    first: async () => null,
                  };
                },
              };
            },
          },
        },
      };
    };

    const { env: env2, rows } = makeMockEnv();
    const body = { name: 'Repeat', email: 'repeat@x.com', phone: '+48500000000', note: 'first' };

    // First submission
    const r1 = await tryLeadRoutes(reqJson('/api/leads', body), env2, new URL('https://manicbot.com/api/leads'));
    expect(r1.status).toBe(200);

    // Second submission — same email, different note
    const r2 = await tryLeadRoutes(
      reqJson('/api/leads', { ...body, note: 'second' }),
      env2,
      new URL('https://manicbot.com/api/leads'),
    );
    expect(r2.status).toBe(200);

    // Two lead rows
    expect(rows.leads).toHaveLength(2);
    // But only ONE marketing contact, with lead_count = 2
    expect(rows.contacts.size).toBe(1);
    expect(rows.contacts.get('repeat@x.com').lead_count).toBe(2);
  });

  it('caps leads at 10 per email and returns already_submitted (no new row, no TG)', async () => {
    env.BOT_TOKEN = 'TOK';
    env.ADMIN_CHAT_ID = '1';
    const tgCalls = [];
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('api.telegram.org')) tgCalls.push(String(url));
      return new Response('{"ok":true}', { status: 200 });
    });
    try {
      for (let i = 0; i < 10; i++) {
        const r = await tryLeadRoutes(
          reqJson('/api/leads', { name: 'Cap', email: 'cap@x.com', phone: '+48500000000' }),
          env, new URL('https://manicbot.com/api/leads'),
        );
        expect(r.status, `call ${i}`).toBe(200);
        expect(await r.json()).toEqual({ ok: true });
      }
      expect(rows.filter(r => r.table === 'leads')).toHaveLength(10);
      expect(tgCalls).toHaveLength(10);

      // 11th: silent ack, no new row, no TG
      const r11 = await tryLeadRoutes(
        reqJson('/api/leads', { name: 'Cap', email: 'cap@x.com', phone: '+48500000000' }),
        env, new URL('https://manicbot.com/api/leads'),
      );
      expect(r11.status).toBe(200);
      expect(await r11.json()).toEqual({ ok: true, already_submitted: true });
      expect(rows.filter(r => r.table === 'leads')).toHaveLength(10);
      expect(tgCalls).toHaveLength(10);

      // Different email still accepted
      const rOther = await tryLeadRoutes(
        reqJson('/api/leads', { name: 'New', email: 'other@x.com', phone: '+48500000000' }),
        env, new URL('https://manicbot.com/api/leads'),
      );
      expect(rOther.status).toBe(200);
      expect(await rOther.json()).toEqual({ ok: true });
      expect(rows.filter(r => r.table === 'leads')).toHaveLength(11);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('sends TG notification on EVERY submission, not just the first', async () => {
    env.BOT_TOKEN = 'TOKEN';
    env.ADMIN_CHAT_ID = '42';
    const tgCalls = [];
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes('api.telegram.org')) tgCalls.push(String(url));
      return new Response('{"ok":true}', { status: 200 });
    });
    try {
      for (let i = 0; i < 3; i++) {
        const req = reqJson('/api/leads', {
          name: 'Dup', email: 'dup@x.com', phone: '+48500000000', note: `try ${i}`,
        });
        const res = await tryLeadRoutes(req, env, new URL(req.url));
        expect(res.status).toBe(200);
      }
      expect(tgCalls.length).toBe(3);
    } finally {
      global.fetch = originalFetch;
    }
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

  it('does NOT send welcome email when RESEND_API_KEY is missing (warns instead)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      return new Response('{}', { status: 200 });
    });
    try {
      const r = await tryLeadRoutes(
        reqJson('/api/email-subscribe', { email: 'nokey@test.com', locale: 'en' }, '6.6.6.6'),
        env, new URL('https://manicbot.com/api/email-subscribe'),
      );
      expect(r.status).toBe(200);
      await new Promise((r) => setTimeout(r, 10));
      expect(calls.filter((u) => u.includes('api.resend.com'))).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('RESEND_API_KEY or RESEND_FROM missing'));
    } finally {
      global.fetch = originalFetch;
      warnSpy.mockRestore();
    }
  });

  it('uses execCtx.waitUntil so the welcome email survives after response', async () => {
    const env2 = {
      RESEND_API_KEY: 'rk',
      RESEND_FROM: 'ManicBot <noreply@manicbot.com>',
      DB: {
        prepare() {
          return {
            bind() {
              return {
                run: async () => ({ success: true }),
                first: async () => null,
              };
            },
          };
        },
      },
    };
    const tracked = [];
    const execCtx = { waitUntil: (p) => { tracked.push(p); } };
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => new Response('{"id":"1"}', { status: 200 }));
    try {
      const r = await tryLeadRoutes(
        reqJson('/api/email-subscribe', { email: 'wu@test.com', locale: 'en' }, '5.5.5.5'),
        env2, new URL('https://manicbot.com/api/email-subscribe'), execCtx,
      );
      expect(r.status).toBe(200);
      expect(tracked).toHaveLength(1);
      await Promise.all(tracked);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({ method: 'POST' }),
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('sends welcome email via Resend on first subscribe only', async () => {
    // Custom env that tracks whether the email already exists
    const subs = new Set();
    const env2 = {
      RESEND_API_KEY: 'rk_test',
      RESEND_FROM: 'ManicBot <noreply@manicbot.com>',
      DB: {
        prepare(sql) {
          return {
            bind(...params) {
              return {
                run: async () => {
                  if (sql.includes('INSERT INTO email_subscribers')) subs.add(params[0]);
                  return { success: true };
                },
                first: async () => {
                  if (sql.includes('SELECT id FROM email_subscribers')) {
                    return subs.has(params[0]) ? { id: 1 } : null;
                  }
                  return null;
                },
              };
            },
          };
        },
      },
    };
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response('{"id":"e_1"}', { status: 200 });
    });
    try {
      // First time: new subscriber → email sent
      const r1 = await tryLeadRoutes(
        reqJson('/api/email-subscribe', { email: 'wel@test.com', locale: 'pl' }, '8.8.8.8'),
        env2, new URL('https://manicbot.com/api/email-subscribe'),
      );
      expect(r1.status).toBe(200);
      await new Promise((r) => setTimeout(r, 10));
      const resendCalls = calls.filter((c) => c.url.includes('api.resend.com'));
      expect(resendCalls).toHaveLength(1);
      const body = JSON.parse(resendCalls[0].init.body);
      expect(body.to).toEqual(['wel@test.com']);
      expect(body.subject).toMatch(/ManicBot/);
      expect(body.html).toContain('ManicBot');
      // Polish copy check
      expect(body.html).toContain('Dziękujemy');

      // Second time: same email → no new email
      const r2 = await tryLeadRoutes(
        reqJson('/api/email-subscribe', { email: 'wel@test.com', locale: 'pl' }, '8.8.8.9'),
        env2, new URL('https://manicbot.com/api/email-subscribe'),
      );
      expect(r2.status).toBe(200);
      await new Promise((r) => setTimeout(r, 10));
      expect(calls.filter((c) => c.url.includes('api.resend.com'))).toHaveLength(1);
    } finally {
      global.fetch = originalFetch;
    }
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
