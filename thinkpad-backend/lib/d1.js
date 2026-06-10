'use strict';
/**
 * Cloudflare D1 HTTP API helper (shared by nightly backup and blog publish).
 * Uses the scoped CLOUDFLARE_API_TOKEN from .env — the ThinkPad never carries
 * the master ADMIN_KEY (see nightly.js history for why).
 */
const { httpJson } = require('./http');

function createD1({
  accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
  apiToken = process.env.CLOUDFLARE_API_TOKEN,
  databaseId = process.env.D1_DATABASE_ID,
  transport = httpJson,
} = {}) {
  const isConfigured = Boolean(accountId && apiToken && databaseId);
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  async function raw(sql, params = []) {
    if (!isConfigured) throw new Error('D1 is not configured (CLOUDFLARE_* env missing)');
    const res = await transport(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
      timeoutMs: 30000,
    });
    if (res.status !== 200 || !res.data?.success) {
      const detail = JSON.stringify(res.data?.errors || res.data || res.body || `status ${res.status}`);
      throw new Error(`D1 query failed: ${detail}`);
    }
    return res.data.result?.[0] || {};
  }

  return {
    isConfigured,
    /** SELECT-style: returns rows. */
    async query(sql, params = []) {
      return (await raw(sql, params)).results ?? [];
    },
    /** INSERT/UPDATE-style: returns meta ({ changes, ... }). */
    async exec(sql, params = []) {
      return (await raw(sql, params)).meta ?? {};
    },
  };
}

module.exports = { createD1 };
