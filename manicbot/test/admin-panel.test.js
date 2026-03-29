import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/utils/security.js', () => ({
  timingSafeEqual: vi.fn(() => true),
  checkAdmin: vi.fn(() => true),
}));

vi.mock('../src/services/appointments.js', () => ({
  getAdminAllApts: vi.fn(async () => [
    {
      id: 'apt_1',
      userName: 'Anna',
      chatId: 777,
      svcId: 'gel',
      date: '2026-03-29',
      time: '10:00',
      status: 'confirmed',
      ts: Date.now() + 60_000,
      createdAt: Date.now(),
      cx: 0,
    },
  ]),
}));

vi.mock('../src/services/services.js', () => ({
  initServices: vi.fn(async (ctx) => {
    ctx.svc = [{ id: 'gel', e: '💎' }];
  }),
}));

vi.mock('../src/telegram.js', () => ({
  api: vi.fn(),
}));

import { tryAdminPanel } from '../src/http/adminPanelHttp.js';

function makeDb(users, channelConfigs) {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async all() {
              if (sql.includes('FROM users')) return { results: users };
              if (sql.includes('FROM channel_configs')) return { results: channelConfigs };
              return { results: [] };
            },
            async first() {
              return null;
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  };
}

describe('tryAdminPanel', () => {
  it('renders the read-only channels section with Instagram and WhatsApp status', async () => {
    const request = new Request('https://example.com/admin');
    const url = new URL(request.url);
    const ADMIN_401 = new Response('Unauthorized', { status: 401 });
    const ctx = {
      ADMIN_KEY: 'secret',
      tenantId: 'tenant_demo',
      db: makeDb(
        [
          {
            chat_id: 777,
            name: 'Anna',
            phone: '+48123123123',
            tg_username: 'anna_nails',
            tg_lang: 'ru',
            registered_at: Date.now(),
          },
        ],
        [
          {
            channel_type: 'instagram',
            active: 1,
            config: JSON.stringify({ page_id: 'page_42' }),
          },
          {
            channel_type: 'whatsapp',
            active: 0,
            config: JSON.stringify({ phone_number_id: 'phone_007' }),
          },
        ],
      ),
      bot: { botId: '123456789' },
      svc: [],
    };

    const response = await tryAdminPanel(request, ctx, url, ADMIN_401);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('📡 Каналы');
    expect(html).toContain('Instagram');
    expect(html).toContain('WhatsApp');
    expect(html).toContain('page_42');
    expect(html).toContain('phone_007');
    expect(html).toContain('https://example.com/webhook/ig');
    expect(html).toContain('https://example.com/webhook/wa');
  });
});
