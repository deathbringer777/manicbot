/**
 * Shared Graph API POST with retry + exponential backoff.
 * Used by Instagram and WhatsApp adapters.
 */

const GRAPH_API = 'https://graph.facebook.com/v21.0';

/**
 * @param {string} path - Graph API path (e.g. "/{pageId}/messages")
 * @param {string} token - Access token
 * @param {object} body - JSON body
 * @param {{ maxRetries?: number, label?: string }} [opts]
 * @returns {Promise<{ ok: boolean, data?: any, status?: number, error?: string }>}
 */
export async function graphPost(path, token, body, { maxRetries = 2, label = 'graph' } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${GRAPH_API}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, data };
      // 429 (rate limit) or 5xx (server error) → retry
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        console.warn(`[${label}] POST ${path} got ${res.status}, retry ${attempt + 1}/${maxRetries}`);
        await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
        continue;
      }
      console.error(`[${label}] POST ${path} failed ${res.status}:`, JSON.stringify(data));
      return { ok: false, status: res.status, error: data.error?.message ?? 'unknown' };
    } catch (e) {
      if (attempt < maxRetries) {
        console.warn(`[${label}] POST ${path} fetch error, retry ${attempt + 1}/${maxRetries}:`, e.message);
        await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
        continue;
      }
      console.error(`[${label}] fetch error:`, e.message);
      return { ok: false, error: e.message };
    }
  }
}
