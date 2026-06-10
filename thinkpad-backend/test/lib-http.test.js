'use strict';
/**
 * lib/http.js — single shared httpJson() (today the same helper is
 * copy-pasted in 3 crons). Tested against a real local HTTP server.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { httpJson } = require('../lib/http');

function withServer(handler, fn) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', async () => {
      const { port } = srv.address();
      try {
        await fn(`http://127.0.0.1:${port}`);
        srv.close(() => resolve());
      } catch (e) {
        srv.close(() => reject(e));
      }
    });
  });
}

test('GET: parses JSON body and exposes status', async () => {
  await withServer(
    (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); },
    async (base) => {
      const res = await httpJson(`${base}/x`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.data, { ok: true });
    },
  );
});

test('POST: object body is JSON-encoded with content-type', async () => {
  await withServer(
    (req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        assert.equal(req.headers['content-type'], 'application/json');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ echo: JSON.parse(body) }));
      });
    },
    async (base) => {
      const res = await httpJson(`${base}/post`, { method: 'POST', body: { a: 1 } });
      assert.deepEqual(res.data, { echo: { a: 1 } });
    },
  );
});

test('non-JSON response is returned as raw body, not an exception', async () => {
  await withServer(
    (req, res) => { res.writeHead(502); res.end('bad gateway'); },
    async (base) => {
      const res = await httpJson(`${base}/raw`);
      assert.equal(res.status, 502);
      assert.equal(res.body, 'bad gateway');
      assert.equal(res.data, undefined);
    },
  );
});

test('timeout rejects', async () => {
  await withServer(
    () => { /* never respond */ },
    async (base) => {
      await assert.rejects(() => httpJson(`${base}/slow`, { timeoutMs: 80 }), /timeout/i);
    },
  );
});
