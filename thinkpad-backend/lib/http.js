'use strict';
/**
 * httpJson(url, opts) — minimal promise HTTP client shared by all crons
 * (previously copy-pasted into nightly/blog/health-check).
 *
 * Returns { status, headers, data } when the response body is JSON,
 * { status, headers, body } otherwise. Network errors and timeouts reject.
 */
const http = require('http');
const https = require('https');

const DEFAULT_TIMEOUT_MS = 30000;

function httpJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'http:' ? http : https;

    const headers = { ...(options.headers || {}) };
    let payload = null;
    if (options.body !== undefined && options.body !== null) {
      if (typeof options.body === 'string') {
        payload = options.body;
      } else {
        payload = JSON.stringify(options.body);
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
      }
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + (parsed.search || ''),
      method: options.method || 'GET',
      headers,
      timeout: options.timeoutMs || options.timeout || DEFAULT_TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, body, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

module.exports = { httpJson };
