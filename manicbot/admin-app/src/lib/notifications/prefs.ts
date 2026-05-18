/**
 * Notification preferences — pure logic shared by the settings UI, the
 * admin-app tRPC writers, and the Worker fanout.
 *
 * Stored as a JSON blob in `web_users.notification_prefs` (migration 0077).
 * NULL or missing fields fall back to the defaults below. This means a
 * just-registered user automatically gets the «sensible default» fanout
 * (everything in-app, push for everything except marketing + birthday).
 *
 * The Worker mirrors this file at manicbot/src/services/notificationPrefs.js —
 * keep the category list + defaults in lockstep.
 */

export const NOTIFICATION_CATEGORIES = [
  "appointment",
  "support",
  "birthday",
  "platform",
  "master",
  "reminder",
  "messenger",
  "billing",
  "marketing",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface CategoryPref {
  /** Show in the bell + /notifications feed. */
  inapp: boolean;
  /** Send a browser push notification (requires push subscription). */
  push: boolean;
}

export interface NotificationPrefs {
  categories: Record<NotificationCategory, CategoryPref>;
}

/**
 * Defaults applied when a row has NULL prefs OR a category is missing
 * from a partial blob. Everything in-app by default; push for everything
 * except low-urgency channels (marketing, birthday) to avoid annoying
 * users who haven't opted into push.
 */
export const DEFAULT_PREFS: NotificationPrefs = {
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
  },
};

/** Map a kind slug (e.g. "appointment.created") to its category. */
export function categoryForKind(kind: string): NotificationCategory | null {
  const prefix = kind.split(".", 1)[0];
  if (!prefix) return null;
  // The `thread.` legacy prefix collapses into messenger like kindMeta does.
  if (prefix === "thread") return "messenger";
  if ((NOTIFICATION_CATEGORIES as readonly string[]).includes(prefix)) {
    return prefix as NotificationCategory;
  }
  return null;
}

/**
 * Parse a stored JSON blob into a complete NotificationPrefs object.
 * Always returns a complete shape — missing categories or malformed JSON
 * are filled from DEFAULT_PREFS. Never throws.
 */
export function parsePrefs(raw: string | null | undefined): NotificationPrefs {
  if (!raw) return DEFAULT_PREFS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFS;
  }
  if (!parsed || typeof parsed !== "object") return DEFAULT_PREFS;
  const cats = (parsed as { categories?: unknown }).categories;
  if (!cats || typeof cats !== "object") return DEFAULT_PREFS;

  const out: NotificationPrefs = {
    categories: { ...DEFAULT_PREFS.categories },
  };
  for (const cat of NOTIFICATION_CATEGORIES) {
    const v = (cats as Record<string, unknown>)[cat];
    if (v && typeof v === "object") {
      out.categories[cat] = {
        inapp: typeof (v as CategoryPref).inapp === "boolean"
          ? (v as CategoryPref).inapp
          : DEFAULT_PREFS.categories[cat].inapp,
        push: typeof (v as CategoryPref).push === "boolean"
          ? (v as CategoryPref).push
          : DEFAULT_PREFS.categories[cat].push,
      };
    }
  }
  return out;
}

/**
 * Should we deliver this kind on this channel given the user's prefs?
 *
 *   shouldDeliver("appointment.created", prefs, "inapp") → true/false
 *
 * Unknown kinds (no matching prefix) always deliver — better to surface
 * an unknown notification than silently swallow it.
 */
export function shouldDeliver(
  kind: string,
  prefs: NotificationPrefs,
  channel: keyof CategoryPref,
): boolean {
  const cat = categoryForKind(kind);
  if (!cat) return true;
  return prefs.categories[cat][channel];
}

/**
 * Serialize prefs back to the canonical JSON shape we store. The result
 * is stable: same input always produces the same string (keys are listed
 * in NOTIFICATION_CATEGORIES order, not Object.keys order).
 */
export function serializePrefs(prefs: NotificationPrefs): string {
  const cats: Record<string, CategoryPref> = {};
  for (const cat of NOTIFICATION_CATEGORIES) {
    cats[cat] = prefs.categories[cat];
  }
  return JSON.stringify({ categories: cats });
}
