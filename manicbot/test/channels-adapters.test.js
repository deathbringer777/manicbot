/**
 * Tests for multi-channel adapter layer:
 *  - types.js (makeInbound, makeOutbound)
 *  - telegram.js (TelegramAdapter.normalize, renderButtons)
 *  - whatsapp.js (WhatsAppAdapter.normalize, htmlToWhatsApp, _buildInteractive)
 *  - instagram.js (InstagramAdapter.normalize, htmlToPlainText)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeInbound, makeOutbound } from '../src/channels/types.js';
import { TelegramAdapter } from '../src/channels/telegram.js';
import { WhatsAppAdapter } from '../src/channels/whatsapp.js';
import { InstagramAdapter, parseInstagramIgnoreSenderIds } from '../src/channels/instagram.js';

// ─── types.js ────────────────────────────────────────────────────────────────

describe('makeInbound', () => {
  it('applies defaults for missing fields', () => {
    const m = makeInbound({ channel: 'whatsapp', channelUserId: '123' });
    expect(m.channel).toBe('whatsapp');
    expect(m.channelUserId).toBe('123');
    expect(m.tenantId).toBeNull();
    expect(m.text).toBeNull();
    expect(m.contact).toBeNull();
    expect(m.photo).toBeNull();
    expect(m.callbackData).toBeNull();
    expect(m.callbackMessageId).toBeNull();
    expect(m.userName).toBeNull();
    expect(m.userLang).toBeNull();
    expect(typeof m.timestamp).toBe('number');
  });

  it('preserves all provided fields', () => {
    const m = makeInbound({
      channel: 'instagram',
      channelUserId: 'ig_123',
      tenantId: 't_abc',
      text: 'hello',
      callbackData: 'sv:classic',
      userName: 'Anna',
      userLang: 'ru',
      timestamp: 1700000000000,
    });
    expect(m.channel).toBe('instagram');
    expect(m.text).toBe('hello');
    expect(m.callbackData).toBe('sv:classic');
    expect(m.timestamp).toBe(1700000000000);
  });
});

describe('makeOutbound', () => {
  it('defaults parseMode to HTML', () => {
    const m = makeOutbound({ text: 'hi' });
    expect(m.parseMode).toBe('HTML');
    expect(m.buttons).toBeNull();
    expect(m.photo).toBeNull();
    expect(m.document).toBeNull();
    expect(m.editMessageId).toBeNull();
  });
});

// ─── TelegramAdapter ─────────────────────────────────────────────────────────

function makeTelegramAdapter(tenantId = 't_test') {
  return new TelegramAdapter({ tenantId, TG: 'https://api.telegram.org/bot123:token' });
}

describe('TelegramAdapter.normalize — message', () => {
  const adapter = makeTelegramAdapter();

  it('normalizes a text message', () => {
    const msg = {
      chat: { id: 123456 },
      from: { id: 123456, first_name: 'Anna', language_code: 'ru' },
      text: '/start',
      date: 1700000000,
    };
    const inbound = adapter.normalize({ message: msg });
    expect(inbound.channel).toBe('telegram');
    expect(inbound.channelUserId).toBe('123456');
    expect(inbound.text).toBe('/start');
    expect(inbound.userName).toBe('Anna');
    expect(inbound.userLang).toBe('ru');
    expect(inbound.callbackData).toBeNull();
    expect(inbound.timestamp).toBe(1700000000000);
  });

  it('normalizes a contact share', () => {
    const msg = {
      chat: { id: 99 },
      from: { id: 99 },
      contact: { phone_number: '+48123456789', first_name: 'Anna', last_name: 'K' },
      date: 1700000000,
    };
    const inbound = adapter.normalize({ message: msg });
    expect(inbound.contact).toEqual({ phone: '+48123456789', firstName: 'Anna', lastName: 'K' });
    expect(inbound.text).toBeNull();
  });

  it('picks the largest photo file_id', () => {
    const msg = {
      chat: { id: 1 }, from: { id: 1 }, date: 1,
      photo: [{ file_id: 'small' }, { file_id: 'medium' }, { file_id: 'large' }],
    };
    const inbound = adapter.normalize({ message: msg });
    expect(inbound.photo).toBe('large');
  });
});

describe('TelegramAdapter.normalize — callback_query', () => {
  const adapter = makeTelegramAdapter();

  it('normalizes a callback query', () => {
    const cb = {
      id: 'cb_001',
      from: { id: 777, first_name: 'Bob', language_code: 'en' },
      message: { chat: { id: 777 }, message_id: 42 },
      data: 'sv:manicure',
    };
    const inbound = adapter.normalize({ callback_query: cb });
    expect(inbound.channel).toBe('telegram');
    expect(inbound.channelUserId).toBe('777');
    expect(inbound.callbackData).toBe('sv:manicure');
    expect(inbound.callbackMessageId).toBe('42');
    expect(inbound.text).toBeNull();
  });
});

describe('TelegramAdapter.renderButtons', () => {
  const adapter = makeTelegramAdapter();

  it('builds inline_keyboard from normalized rows', () => {
    const rows = [
      [{ text: 'Manicure', callbackData: 'sv:manicure' }],
      [{ text: 'Pedicure', callbackData: 'sv:pedicure' }, { text: 'Cancel', callbackData: 'cancel' }],
    ];
    const result = adapter.renderButtons(rows);
    expect(result.reply_markup.inline_keyboard[0][0].callback_data).toBe('sv:manicure');
    expect(result.reply_markup.inline_keyboard[1]).toHaveLength(2);
  });

  it('returns empty object for no buttons', () => {
    expect(adapter.renderButtons([])).toEqual({});
    expect(adapter.renderButtons(null)).toEqual({});
  });
});

// ─── WhatsAppAdapter ─────────────────────────────────────────────────────────

function makeWAAdapter(phoneNumberId = '123456789', token = 'test_token') {
  return new WhatsAppAdapter({
    tenantId: 't_wa',
    channelConfig: {
      config: { phone_number_id: phoneNumberId },
      token,
    },
  });
}

describe('WhatsAppAdapter.normalize', () => {
  const adapter = makeWAAdapter();

  it('normalizes a text message', () => {
    const entry = {
      changes: [{
        value: {
          messages: [{ type: 'text', from: '48123456789', text: { body: 'Hej!' }, timestamp: '1700000000' }],
          contacts: [{ wa_id: '48123456789', profile: { name: 'Anna' } }],
        },
      }],
    };
    const inbound = adapter.normalize(entry);
    expect(inbound.channel).toBe('whatsapp');
    expect(inbound.channelUserId).toBe('48123456789');
    expect(inbound.text).toBe('Hej!');
    expect(inbound.userName).toBe('Anna');
    expect(inbound.timestamp).toBe(1700000000000);
  });

  it('normalizes an interactive button_reply', () => {
    const entry = {
      changes: [{
        value: {
          messages: [{
            type: 'interactive',
            from: '48111222333',
            interactive: { type: 'button_reply', button_reply: { id: 'sv:classic', title: 'Classic' } },
            timestamp: '1700000001',
          }],
        },
      }],
    };
    const inbound = adapter.normalize(entry);
    expect(inbound.callbackData).toBe('sv:classic');
    expect(inbound.text).toBe('Classic');
  });

  it('normalizes an interactive list_reply', () => {
    const entry = {
      changes: [{
        value: {
          messages: [{
            type: 'interactive',
            from: '48000000000',
            interactive: { type: 'list_reply', list_reply: { id: 'dt:2026-04-01', title: '1 April' } },
            timestamp: '1700000002',
          }],
        },
      }],
    };
    const inbound = adapter.normalize(entry);
    expect(inbound.callbackData).toBe('dt:2026-04-01');
  });

  it('normalizes a contacts message', () => {
    const entry = {
      changes: [{
        value: {
          messages: [{
            type: 'contacts',
            from: '48555666777',
            contacts: [{ phones: [{ phone: '+48555666777' }], name: { first_name: 'Kate', last_name: 'W' } }],
            timestamp: '1700000003',
          }],
        },
      }],
    };
    const inbound = adapter.normalize(entry);
    expect(inbound.contact).toEqual({ phone: '+48555666777', firstName: 'Kate', lastName: 'W' });
  });

  it('returns null for an entry with no messages', () => {
    const entry = { changes: [{ value: { statuses: [{ id: 'msg_id', status: 'delivered' }] } }] };
    expect(adapter.normalize(entry)).toBeNull();
  });

  it('returns null for a null entry', () => {
    expect(adapter.normalize(null)).toBeNull();
  });
});

describe('WhatsAppAdapter.htmlToWhatsApp', () => {
  const adapter = makeWAAdapter();

  it('converts <b> to *bold*', () => {
    expect(adapter.htmlToWhatsApp('<b>Hello</b>')).toBe('*Hello*');
  });

  it('converts <i> to _italic_', () => {
    expect(adapter.htmlToWhatsApp('<i>world</i>')).toBe('_world_');
  });

  it('converts <code> to ```code```', () => {
    expect(adapter.htmlToWhatsApp('<code>npm start</code>')).toBe('```npm start```');
  });

  it('converts <a href> to text (url)', () => {
    expect(adapter.htmlToWhatsApp('<a href="https://example.com">click</a>')).toBe('click (https://example.com)');
  });

  it('strips unknown tags', () => {
    expect(adapter.htmlToWhatsApp('<div>test</div>')).toBe('test');
  });

  it('decodes HTML entities', () => {
    expect(adapter.htmlToWhatsApp('&lt;hello&gt; &amp; &quot;world&quot;')).toBe('<hello> & "world"');
  });

  it('returns empty string for null/empty input', () => {
    expect(adapter.htmlToWhatsApp('')).toBe('');
    expect(adapter.htmlToWhatsApp(null)).toBe('');
  });
});

describe('WhatsAppAdapter._buildInteractive', () => {
  const adapter = makeWAAdapter();

  it('builds reply buttons for ≤3 items', () => {
    const buttons = [[
      { text: 'Yes', callbackData: 'confirm' },
      { text: 'No', callbackData: 'cancel' },
    ]];
    const body = adapter._buildInteractive('48000', 'Choose:', buttons);
    expect(body.type).toBe('interactive');
    expect(body.interactive.type).toBe('button');
    expect(body.interactive.action.buttons).toHaveLength(2);
    expect(body.interactive.action.buttons[0].reply.id).toBe('confirm');
  });

  it('builds a list for 4–10 items', () => {
    const buttons = [Array.from({ length: 5 }, (_, i) => ({ text: `Opt ${i}`, callbackData: `opt_${i}` }))];
    const body = adapter._buildInteractive('48000', 'Pick one:', buttons);
    expect(body.interactive.type).toBe('list');
    expect(body.interactive.action.sections[0].rows).toHaveLength(5);
  });

  it('paginates into multiple sections for >10 items', () => {
    const buttons = [Array.from({ length: 15 }, (_, i) => ({ text: `Item ${i}`, callbackData: `item_${i}` }))];
    const body = adapter._buildInteractive('48000', 'Select:', buttons);
    expect(body.interactive.type).toBe('list');
    expect(body.interactive.action.sections).toHaveLength(2);
    expect(body.interactive.action.sections[0].rows).toHaveLength(10);
    expect(body.interactive.action.sections[1].rows).toHaveLength(5);
  });

  it('truncates button titles to 20 chars', () => {
    const buttons = [[{ text: 'A very long button title here', callbackData: 'x' }]];
    const body = adapter._buildInteractive('48000', 'test', buttons);
    const title = body.interactive.action.buttons[0].reply.title;
    expect(title.length).toBeLessThanOrEqual(20);
  });
});

// ─── InstagramAdapter ─────────────────────────────────────────────────────────

function makeIGAdapter(pageId = 'pg_123', token = 'ig_token', instagramIgnoreSenderIds = undefined) {
  return new InstagramAdapter({
    tenantId: 't_ig',
    channelConfig: {
      config: { page_id: pageId },
      token,
    },
    ...(instagramIgnoreSenderIds !== undefined ? { instagramIgnoreSenderIds } : {}),
  });
}

describe('WhatsAppAdapter.sendDocument', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends a document message for an https URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid' }] }), { status: 200 }),
    );
    const adapter = makeWAAdapter();
    await adapter.sendDocument('user1', 'https://files.test/doc.pdf', 'doc.pdf', 'Receipt');
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.type).toBe('document');
    expect(body.document.link).toBe('https://files.test/doc.pdf');
  });

  it('does NOT send a non-https (http://) link as a document — #329 https-only', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid' }] }), { status: 200 }),
    );
    const adapter = makeWAAdapter();
    await adapter.sendDocument('user1', 'http://insecure.test/doc.pdf', 'doc.pdf', 'Receipt');
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.type).not.toBe('document');                          // falls back to text
    expect(JSON.stringify(body)).not.toContain('http://insecure.test'); // insecure link not forwarded
  });
});

describe('InstagramAdapter.normalize', () => {
  const adapter = makeIGAdapter();

  it('normalizes a text message', () => {
    const entry = {
      id: 'pg_123',
      messaging: [{
        sender: { id: 'igsid_abc' },
        message: { text: 'Hi salon!', mid: 'm_001' },
        timestamp: 1700000000000,
      }],
    };
    const inbound = adapter.normalize(entry);
    expect(inbound.channel).toBe('instagram');
    expect(inbound.channelUserId).toBe('igsid_abc');
    expect(inbound.text).toBe('Hi salon!');
    expect(inbound.callbackData).toBeNull();
  });

  it('normalizes a quick_reply (callback)', () => {
    const entry = {
      id: 'pg_123',
      messaging: [{
        sender: { id: 'igsid_xyz' },
        message: { text: 'Manicure', quick_reply: { payload: 'sv:manicure' } },
        timestamp: 1700000001000,
      }],
    };
    const inbound = adapter.normalize(entry);
    expect(inbound.callbackData).toBe('sv:manicure');
  });

  it('normalizes a postback', () => {
    const entry = {
      id: 'pg_123',
      messaging: [{
        sender: { id: 'igsid_pb' },
        postback: { payload: 'start', title: 'Get started' },
        timestamp: 1700000002000,
      }],
    };
    const inbound = adapter.normalize(entry);
    expect(inbound.callbackData).toBe('start');
    expect(inbound.text).toBe('Get started');
  });

  it('normalizes an image attachment', () => {
    const entry = {
      id: 'pg_123',
      messaging: [{
        sender: { id: 'igsid_img' },
        message: { attachments: [{ type: 'image', payload: { url: 'https://cdn.example.com/photo.jpg' } }] },
        timestamp: 1700000003000,
      }],
    };
    const inbound = adapter.normalize(entry);
    expect(inbound.photo).toBe('https://cdn.example.com/photo.jpg');
  });

  it('picks user text when read receipt is the first messaging item', () => {
    const entry = {
      id: 'pg_123',
      messaging: [
        { sender: { id: 'u1' }, recipient: { id: 'pg_123' }, timestamp: 1, read: { watermark: 100 } },
        { sender: { id: 'u1' }, message: { text: 'hello after read' }, timestamp: 2 },
      ],
    };
    const inbound = adapter.normalize(entry);
    expect(inbound?.text).toBe('hello after read');
    expect(inbound?.channelUserId).toBe('u1');
  });

  it('returns null for entry with no messaging', () => {
    expect(adapter.normalize({ id: 'pg_123' })).toBeNull();
    expect(adapter.normalize(null)).toBeNull();
  });

  it('returns null for is_echo (outbound from page)', () => {
    const entry = {
      id: 'pg_123',
      messaging: [{
        sender: { id: 'page_igsid' },
        message: { text: 'Hi', is_echo: true },
        timestamp: 1700000004000,
      }],
    };
    expect(adapter.normalize(entry)).toBeNull();
  });

  it('returns null when sender IGSID is in ignore set', () => {
    const blocked = makeIGAdapter('pg_123', 'tok', new Set(['999888777']));
    const entry = {
      id: 'pg_123',
      messaging: [{
        sender: { id: '999888777' },
        message: { text: 'Staff account' },
        timestamp: 1700000005000,
      }],
    };
    expect(blocked.normalize(entry)).toBeNull();
  });

  it('still normalizes when ignore set does not match sender', () => {
    const blocked = makeIGAdapter('pg_123', 'tok', new Set(['999888777']));
    const entry = {
      id: 'pg_123',
      messaging: [{
        sender: { id: '111222333' },
        message: { text: 'Client' },
        timestamp: 1700000006000,
      }],
    };
    const inbound = blocked.normalize(entry);
    expect(inbound).not.toBeNull();
    expect(inbound.channelUserId).toBe('111222333');
  });
});

describe('parseInstagramIgnoreSenderIds', () => {
  it('returns empty Set for empty input', () => {
    expect([...parseInstagramIgnoreSenderIds('')]).toEqual([]);
    expect([...parseInstagramIgnoreSenderIds(null)]).toEqual([]);
    expect([...parseInstagramIgnoreSenderIds(undefined)]).toEqual([]);
  });

  it('splits on comma and whitespace', () => {
    const s = parseInstagramIgnoreSenderIds(' 111 , 222\t333 ');
    expect(s.has('111')).toBe(true);
    expect(s.has('222')).toBe(true);
    expect(s.has('333')).toBe(true);
  });
});

describe('InstagramAdapter.htmlToPlainText', () => {
  const adapter = makeIGAdapter();

  it('strips all HTML tags', () => {
    expect(adapter.htmlToPlainText('<b>Bold</b> and <i>italic</i>')).toBe('Bold and italic');
  });

  it('preserves line breaks from <br>', () => {
    expect(adapter.htmlToPlainText('line1<br>line2')).toBe('line1\nline2');
  });

  it('converts <a> to text (url)', () => {
    expect(adapter.htmlToPlainText('<a href="https://x.com">click</a>')).toBe('click (https://x.com)');
  });

  it('decodes entities', () => {
    expect(adapter.htmlToPlainText('&lt;tag&gt; &amp; text')).toBe('<tag> & text');
  });

  it('collapses triple newlines to double', () => {
    expect(adapter.htmlToPlainText('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('returns empty string for null/empty', () => {
    expect(adapter.htmlToPlainText('')).toBe('');
    expect(adapter.htmlToPlainText(null)).toBe('');
  });
});

describe('InstagramAdapter quick_replies limit', () => {
  it('type is instagram', () => {
    expect(makeIGAdapter().type).toBe('instagram');
  });

  it('renderButtons returns instagram_quick_replies metadata', () => {
    const rows = [[{ text: 'Yes', callbackData: 'yes' }]];
    expect(makeIGAdapter().renderButtons(rows)).toEqual({ type: 'instagram_quick_replies', rows });
  });
});

describe('InstagramAdapter outbound Graph host', () => {
  it('POSTs to graph.facebook.com with Page id path', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message_id: 'mid' }), { status: 200 }),
    );
    const adapter = makeIGAdapter('my_page_id', 'page_token');
    await adapter.send('igsid_user', { text: 'hello' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v21\.0\/my_page_id\/messages$/);
    fetchSpy.mockRestore();
  });
});
