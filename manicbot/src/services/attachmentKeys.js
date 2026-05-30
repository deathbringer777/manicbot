/**
 * @fileoverview Pure helpers to extract R2/CDN object keys from a message's
 * `attachments_json`. Used by the attachment GC cron sweep to find orphaned
 * objects after messages are soft-deleted.
 *
 * Stored attachment URLs point at the read-through CDN: `.../cdn/<key>` where
 * the key is the content-addressed R2 path `t/{tid}/{kind}-{sha12}.{ext}`.
 */

/** Extract the R2 key from a `.../cdn/<key>` URL (query stripped). */
export function extractCdnKey(url) {
  if (typeof url !== 'string') return null;
  const marker = '/cdn/';
  const i = url.indexOf(marker);
  if (i === -1) return null;
  const key = url.slice(i + marker.length).split('?')[0].split('#')[0];
  return key || null;
}

/**
 * Extract all CDN keys referenced by a `attachments_json` blob
 * (`{ attachments: [{ url, kind }, …] }`). Returns [] for null / invalid JSON.
 */
export function extractAttachmentKeys(attachmentsJson) {
  if (!attachmentsJson || typeof attachmentsJson !== 'string') return [];
  let parsed;
  try {
    parsed = JSON.parse(attachmentsJson);
  } catch {
    return [];
  }
  const atts = Array.isArray(parsed?.attachments) ? parsed.attachments : [];
  const keys = [];
  for (const a of atts) {
    const k = extractCdnKey(a?.url);
    if (k) keys.push(k);
  }
  return keys;
}
