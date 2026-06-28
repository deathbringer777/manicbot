'use strict';
/**
 * HTTP layer for the job-runner, extracted so it is unit-testable without the
 * dotenv / D1 / Claude wiring in job-runner.js.
 *
 * SEC-002: /kick fails CLOSED — no Access verifier ⇒ 503 (never unauthenticated).
 * SEC-004: the kick body is rejected if oversized and otherwise drained; the
 * server caps slowloris-style tie-ups via timeouts.
 */
const http = require('http');

const MAX_KICK_BODY = 1024; // the kick carries no actionable body

/** Pure HTTP request handler (testable with plain req/res stubs — no socket). */
async function handleRequest(req, res, { drain, verifyAccess, logger }) {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }
  if (req.method === 'POST' && req.url === '/kick') {
    if (!verifyAccess) {
      logger?.log('[job-runner] /kick refused: no Access verifier configured (fail-closed)');
      res.writeHead(503, { 'content-type': 'text/plain' });
      return res.end('kick disabled: no verifier');
    }
    if (Number(req.headers['content-length'] || 0) > MAX_KICK_BODY) {
      res.writeHead(413, { 'content-type': 'text/plain' });
      return res.end('payload too large');
    }
    if (typeof req.resume === 'function') req.resume(); // drain the unused body
    try {
      await verifyAccess(req.headers['cf-access-jwt-assertion']);
    } catch (e) {
      logger?.log(`[job-runner] /kick rejected: ${e.message}`);
      res.writeHead(403, { 'content-type': 'text/plain' });
      return res.end('forbidden');
    }
    drain('kick').catch(() => {});
    res.writeHead(202, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}

function createServer(deps) {
  const server = http.createServer((req, res) => {
    handleRequest(req, res, deps).catch(() => {
      try { res.writeHead(500); res.end('error'); } catch { /* socket already gone */ }
    });
  });
  // SEC-004: bound slowloris-style tie-ups of the single listener.
  server.headersTimeout = 5000;
  server.requestTimeout = 10000;
  server.maxRequestsPerSocket = 100;
  return server;
}

module.exports = { handleRequest, createServer, MAX_KICK_BODY };
