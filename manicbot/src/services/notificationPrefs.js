// notificationPrefs.js — Worker mirror of admin-app/lib/notifications/prefs.ts.
//
// Keep CATEGORIES + DEFAULT_PREFS in lockstep with the TS file. The pure
// helpers (parsePrefs, shouldDeliver) are used by `notifyWebUser` in
// userNotify.js to filter the fanout per the recipient's saved settings.

export const NOTIFICATION_CATEGORIES = [
  'appointment',
  'support',
  'birthday',
  'platform',
  'master',
  'reminder',
  'messenger',
  'billing',
  'marketing',
  // PR-B: channel (IG/WA/TG outages) + client (new client lifecycle).
  'channel',
  'client',
];

/**
 * Defaults applied to NULL prefs or any missing category in a partial
 * blob. Mirror of admin-app DEFAULT_PREFS.
 */
export const DEFAULT_PREFS = {
  categories: {
    appointment: { inapp: true, push: true },
    support:     { inapp: true, push: true },
    birthday:    { inapp: true, push: false },
    platform:    { inapp: true, push: true },
    master:      { inapp: true, push: true },
    reminder:    { inapp: true, push: true },
    messenger:   { inapp: true, push: true },
    billing:     { inapp: true, push: true },
    marketing:   { inapp: true, push: false },
    // PR-B: urgent operator-action signals — push by default so a dead IG
    // token (last incident took 6 weeks to detect) lights up immediately.
    channel:     { inapp: true, push: true },
    // PR-B: new-client signal is informational; push off by default.
    client:      { inapp: true, push: false },
  },
};

export function categoryForKind(kind) {
  if (!kind || typeof kind !== 'string') return null;
  const dot = kind.indexOf('.');
  const prefix = dot === -1 ? kind : kind.slice(0, dot);
  if (!prefix) return null;
  if (prefix === 'thread') return 'messenger';
  if (NOTIFICATION_CATEGORIES.includes(prefix)) return prefix;
  return null;
}

export function parsePrefs(raw) {
  if (!raw) return DEFAULT_PREFS;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return DEFAULT_PREFS; }
  if (!parsed || typeof parsed !== 'object') return DEFAULT_PREFS;
  const cats = parsed.categories;
  if (!cats || typeof cats !== 'object') return DEFAULT_PREFS;
  const out = { categories: { ...DEFAULT_PREFS.categories } };
  for (const cat of NOTIFICATION_CATEGORIES) {
    const v = cats[cat];
    if (v && typeof v === 'object') {
      out.categories[cat] = {
        inapp: typeof v.inapp === 'boolean' ? v.inapp : DEFAULT_PREFS.categories[cat].inapp,
        push:  typeof v.push  === 'boolean' ? v.push  : DEFAULT_PREFS.categories[cat].push,
      };
    }
  }
  return out;
}

export function shouldDeliver(kind, prefs, channel) {
  const cat = categoryForKind(kind);
  if (!cat) return true;
  return prefs.categories[cat][channel];
}

/**
 * Load prefs JSON for a web_user from D1. Returns DEFAULT_PREFS when:
 * - webUserId is empty/null
 * - the row doesn't exist
 * - the column is NULL or malformed
 *
 * Never throws — channel filtering must never break a fanout. On DB
 * errors we fall through to defaults so the user keeps getting alerts.
 */
export async function loadPrefsForWebUser(db, webUserId) {
  if (!db || !webUserId) return DEFAULT_PREFS;
  try {
    const row = await db
      .prepare('SELECT notification_prefs FROM web_users WHERE id = ?1 LIMIT 1')
      .bind(String(webUserId))
      .first();
    return parsePrefs(row?.notification_prefs ?? null);
  } catch {
    return DEFAULT_PREFS;
  }
}
