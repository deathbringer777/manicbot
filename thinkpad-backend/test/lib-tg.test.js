'use strict';
/**
 * lib/tg.js — Telegram Bot API helper for crons (direct sendMessage/sendPhoto
 * with inline keyboards; the Worker /admin/notify route can't do buttons).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { createTg, escapeHtml } = require('../lib/tg');

function fakeTransport() {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return { status: 200, data: { ok: true, result: { message_id: 42 } } };
  };
  fn.calls = calls;
  return fn;
}

test('sendMessage posts to the bot API with chat id and HTML parse mode', async () => {
  const transport = fakeTransport();
  const tg = createTg({ token: 'TOK', chatId: '111', transport });
  const res = await tg.sendMessage('hello <b>world</b>');
  assert.equal(transport.calls.length, 1);
  const { url, opts } = transport.calls[0];
  assert.ok(url.includes('https://api.telegram.org/botTOK/sendMessage'));
  assert.equal(opts.body.chat_id, '111');
  assert.equal(opts.body.text, 'hello <b>world</b>');
  assert.equal(opts.body.parse_mode, 'HTML');
  assert.equal(res.message_id, 42);
});

test('sendMessage attaches inline keyboard when given', async () => {
  const transport = fakeTransport();
  const tg = createTg({ token: 'TOK', chatId: '111', transport });
  const kb = [[{ text: 'Go', callback_data: 'x:1' }]];
  await tg.sendMessage('pick', { keyboard: kb });
  assert.deepEqual(transport.calls[0].opts.body.reply_markup, { inline_keyboard: kb });
});

test('sendMessage chunks long text into ≤3500-char messages', async () => {
  const transport = fakeTransport();
  const tg = createTg({ token: 'TOK', chatId: '111', transport });
  await tg.sendMessage('x'.repeat(8000));
  assert.equal(transport.calls.length, 3);
  assert.ok(transport.calls.every(c => c.opts.body.text.length <= 3500));
});

test('unconfigured tg silently no-ops (cron must not crash on missing token)', async () => {
  const transport = fakeTransport();
  const tg = createTg({ token: '', chatId: '', transport });
  const res = await tg.sendMessage('hi');
  assert.equal(res, null);
  assert.equal(transport.calls.length, 0);
});

test('sendPhoto posts photo URL with caption and keyboard', async () => {
  const transport = fakeTransport();
  const tg = createTg({ token: 'TOK', chatId: '5', transport });
  await tg.sendPhoto('https://img/x.jpg', 'cap', { keyboard: [[{ text: 'A', callback_data: 'a' }]] });
  const { url, opts } = transport.calls[0];
  assert.ok(url.endsWith('/sendPhoto'));
  assert.equal(opts.body.photo, 'https://img/x.jpg');
  assert.equal(opts.body.caption, 'cap');
  assert.ok(opts.body.reply_markup.inline_keyboard);
});

test('editMessageText and answerCallback build correct payloads', async () => {
  const transport = fakeTransport();
  const tg = createTg({ token: 'TOK', chatId: '5', transport });
  await tg.editMessageText(99, 'new text');
  await tg.answerCallback('cb-1', 'done');
  assert.ok(transport.calls[0].url.endsWith('/editMessageText'));
  assert.equal(transport.calls[0].opts.body.message_id, 99);
  assert.ok(transport.calls[1].url.endsWith('/answerCallbackQuery'));
  assert.equal(transport.calls[1].opts.body.callback_query_id, 'cb-1');
});

test('escapeHtml escapes the three HTML-significant chars', () => {
  assert.equal(escapeHtml('<b a="1"> & more'), '&lt;b a="1"&gt; &amp; more');
});
