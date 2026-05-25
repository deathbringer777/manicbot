/**
 * Pure helpers for parsing SPF / DKIM / DMARC TXT records.
 *
 * Lives in its own file (no I/O, no top-level side effects) so the
 * deliverability test can unit-test the parsing without hitting DNS.
 *
 * Operator orchestration: scripts/verify-deliverability.mjs.
 */

/**
 * Parse a DMARC TXT record body into a tag-value map.
 *
 * Example input:
 *   "v=DMARC1; p=reject; rua=mailto:postmaster@example.com"
 *
 * Returns `{ v: "DMARC1", p: "reject", rua: "mailto:postmaster@example.com" }`
 * or null if the record doesn't start with `v=DMARC1`.
 *
 * @param {string} txt
 * @returns {Record<string, string> | null}
 */
export function parseDmarc(txt) {
  if (typeof txt !== 'string') return null;
  const trimmed = txt.trim().replace(/^"|"$/g, '');
  if (!/^v\s*=\s*DMARC1\b/i.test(trimmed)) return null;
  const out = {};
  for (const pair of trimmed.split(';')) {
    const [k, ...rest] = pair.trim().split('=');
    if (!k || rest.length === 0) continue;
    out[k.trim().toLowerCase()] = rest.join('=').trim();
  }
  return out;
}

/**
 * Parse an SPF TXT record into mechanisms + final qualifier.
 *
 * Example input:
 *   "v=spf1 include:_spf.mx.cloudflare.net include:_spf.resend.com ~all"
 *
 * Returns:
 *   { v: 'spf1', mechanisms: ['include:_spf.mx.cloudflare.net', 'include:_spf.resend.com'], all: '~all' }
 *
 * @param {string} txt
 * @returns {{ v: string, mechanisms: string[], all: string | null } | null}
 */
export function parseSpf(txt) {
  if (typeof txt !== 'string') return null;
  const trimmed = txt.trim().replace(/^"|"$/g, '');
  if (!/^v\s*=\s*spf1\b/i.test(trimmed)) return null;
  const parts = trimmed.split(/\s+/);
  let v = '';
  let all = null;
  const mechanisms = [];
  for (const p of parts) {
    if (/^v\s*=\s*spf1$/i.test(p)) { v = 'spf1'; continue; }
    if (/^[+\-~?]?all$/i.test(p)) { all = p; continue; }
    mechanisms.push(p);
  }
  return { v, mechanisms, all };
}

/**
 * Detect whether a TXT record looks like a published DKIM public key.
 *
 * DKIM TXT records have varied structure across providers; the most
 * stable signal is the `p=` tag carrying the base64-encoded key. Empty
 * `p=` (`p=;`) means the key has been revoked.
 *
 * @param {string} txt
 * @returns {{ present: boolean, revoked: boolean, hasKey: boolean }}
 */
export function parseDkim(txt) {
  if (typeof txt !== 'string') return { present: false, revoked: false, hasKey: false };
  const trimmed = txt.trim().replace(/^"|"$/g, '');
  const pMatch = trimmed.match(/(?:^|;)\s*p\s*=\s*([^;]*)/i);
  if (!pMatch) return { present: false, revoked: false, hasKey: false };
  const key = pMatch[1].trim();
  return {
    present: true,
    revoked: key.length === 0,
    hasKey: key.length > 0,
  };
}

/**
 * High-level verdict: is this DMARC record fit for production?
 *
 * Definitions:
 *   - 'pass'  — policy ≥ quarantine AND aggregate reporting (`rua`) configured
 *   - 'warn'  — policy ≥ quarantine but no `rua` (we don't see what's
 *               being blocked; impersonation defence works but blind)
 *   - 'fail'  — policy is `none` or missing
 *
 * @param {ReturnType<typeof parseDmarc>} parsed
 * @returns {{ verdict: 'pass'|'warn'|'fail', reasons: string[] }}
 */
export function dmarcVerdict(parsed) {
  if (!parsed) return { verdict: 'fail', reasons: ['no DMARC record published'] };
  const reasons = [];
  const policy = (parsed.p || '').toLowerCase();
  if (policy !== 'reject' && policy !== 'quarantine') {
    reasons.push(`policy is "${policy || 'unset'}" — should be quarantine or reject`);
  }
  if (!parsed.rua) {
    reasons.push('no rua (aggregate reporting) configured');
  }
  if (reasons.length === 0) return { verdict: 'pass', reasons: [] };
  if (policy === 'reject' || policy === 'quarantine') {
    return { verdict: 'warn', reasons };
  }
  return { verdict: 'fail', reasons };
}

/**
 * Pull the named `include:` mechanisms from an SPF record.
 *
 * @param {ReturnType<typeof parseSpf>} parsed
 * @returns {string[]}
 */
export function spfIncludes(parsed) {
  if (!parsed?.mechanisms) return [];
  return parsed.mechanisms
    .filter((m) => /^include:/i.test(m))
    .map((m) => m.slice('include:'.length).toLowerCase());
}

/**
 * Required SPF includes for production. SPF without these means
 * Resend (transactional email) or Cloudflare Email Routing won't pass
 * alignment and emails go to spam.
 */
export const REQUIRED_SPF_INCLUDES = ['_spf.resend.com', '_spf.mx.cloudflare.net'];

/**
 * Required DKIM selector hostname under the sending domain.
 */
export const REQUIRED_DKIM_SELECTOR = 'resend._domainkey';
