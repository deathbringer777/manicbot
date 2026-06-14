'use strict';
/**
 * Thin read-only Google Search Console API client.
 *
 * Covers the three surfaces the monitor cron needs:
 *   - searchAnalytics.query (clicks/impressions/CTR/position, by date or dimension)
 *   - sitemaps.get          (submission + indexed counts, errors/warnings)
 *   - urlInspection.index.inspect (per-URL index coverage state)
 *
 * `auth` is a createGoogleAuth() instance ({ getAccessToken }); `transport` is
 * the shared httpJson, injectable for tests. The property is a DOMAIN property
 * (sc-domain:manicbot.com) and is URL-encoded into the v3 site path.
 */
const { httpJson } = require('./http');

const WEBMASTERS_BASE = 'https://searchconsole.googleapis.com/webmasters/v3';
const INSPECT_URL = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';

function createGsc({ auth, property = 'sc-domain:manicbot.com', transport = httpJson } = {}) {
  const encProperty = encodeURIComponent(property);

  async function request(url, { method = 'GET', body } = {}) {
    const token = await auth.getAccessToken();
    const res = await transport(url, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      ...(body !== undefined ? { body } : {}),
      timeoutMs: 30000,
    });
    if (res?.status >= 400) {
      const detail = res?.data?.error?.message || res?.data?.error || res?.body || `status ${res?.status}`;
      throw new Error(`GSC ${method} ${url} failed: ${detail}`);
    }
    return res?.data;
  }

  /** searchAnalytics.query — body per the Search Analytics API (startDate/endDate/dimensions/rowLimit). */
  function searchAnalytics(query) {
    return request(`${WEBMASTERS_BASE}/sites/${encProperty}/searchAnalytics/query`, { method: 'POST', body: query });
  }

  /** sitemaps.get — feedpath is the full sitemap URL (e.g. https://manicbot.com/sitemap.xml). */
  function getSitemap(feedpath) {
    return request(`${WEBMASTERS_BASE}/sites/${encProperty}/sitemaps/${encodeURIComponent(feedpath)}`);
  }

  /** urlInspection.index.inspect — index coverage for a single URL on this property. */
  function inspectUrl(inspectionUrl) {
    return request(INSPECT_URL, { method: 'POST', body: { inspectionUrl, siteUrl: property } });
  }

  return { searchAnalytics, getSitemap, inspectUrl, property };
}

module.exports = { createGsc };
