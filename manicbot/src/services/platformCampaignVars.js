/**
 * platformCampaignVars — pure personalization layer for platform messages.
 *
 * Substitutes `{token}` placeholders in operator-authored welcome/announcement
 * bodies against a small vars map derived from the tenant + recipient rows the
 * dispatch already loaded (under ctx.tenantId). No DB, no clock — unit-tested in
 * test/platform-campaign-vars.test.js, mirroring the pure due-engine.
 *
 * NOTE: a byte-identical TypeScript twin lives in
 * `admin-app/src/server/messenger/welcomeOnRegister.ts` for the synchronous
 * welcome path (separate build, no shared package). Keep the two in lockstep —
 * same discipline as the dual `ulid` implementations.
 *
 * Token contract:
 *   - known token        → its value (coerced to string; null/undefined → '')
 *   - unknown token      → left VERBATIM ({typo} stays visible, never blanked)
 *   - doubled braces     → de-escaped: `{{` → `{`, `}}` → `}` (no substitution)
 *   - non-string `text`  → ''
 *   - null/invalid vars  → treated as {} (every token left verbatim)
 * Token charset is `[a-z0-9_]` — uppercase/other shapes are left untouched.
 */

// One alternation, scanned left-to-right: `{{`/`}}` are matched BEFORE the
// `{token}` pattern, so escaped braces de-escape to literals and can never be
// mistaken for a placeholder (e.g. `{{salon_name}}` → `{salon_name}`).
const TOKEN_RE = /\{\{|\}\}|\{([a-z0-9_]+)\}/g;

/**
 * @param {string} text   the template body
 * @param {Record<string,unknown>|null|undefined} vars  token → value map
 * @returns {string}
 */
export function renderTemplateVars(text, vars) {
  if (typeof text !== 'string') return '';
  const v = vars && typeof vars === 'object' ? vars : {};
  return text.replace(TOKEN_RE, (match, name) => {
    if (match === '{{') return '{';
    if (match === '}}') return '}';
    if (Object.prototype.hasOwnProperty.call(v, name)) {
      const value = v[name];
      return value == null ? '' : String(value);
    }
    return match; // unknown token — leave verbatim
  });
}

/** First whitespace-delimited word of a name, or '' when absent. */
function firstWord(name) {
  const s = String(name ?? '').trim();
  if (!s) return '';
  return s.split(/\s+/)[0];
}

/**
 * Build the personalization vars for a (tenant, recipient) pair.
 *
 * @param {{name?:string, plan?:string}|null} tenant     tenants row
 * @param {{name?:string}|null}               recipient  web_users row
 * @returns {{salon_name:string, plan:string, owner_name:string, first_name:string}}
 */
export function buildCampaignVars(tenant, recipient) {
  const t = tenant || {};
  const r = recipient || {};
  return {
    salon_name: t.name == null ? '' : String(t.name),
    plan: t.plan == null ? 'start' : String(t.plan),
    owner_name: r.name == null ? '' : String(r.name),
    first_name: firstWord(r.name),
  };
}
