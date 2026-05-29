"use client";

import { useRole } from "~/components/RoleContext";

/**
 * Derived "effective profile" used to scope per-user state (plugin pins,
 * dashboard prefs) on the client.
 *
 * It is simply the authenticated caller's own `web_users.id` — there is no
 * impersonation/preview path. (The former «view as master» preview, which
 * shifted this to another user's id, has been removed.)
 *
 * `effectiveProfileKey` is the string suffix used in localStorage keys:
 *   - "u<webUserId>" → web_users.id
 *   - "anon"         → no auth (loading state / signed-out pages)
 */
export interface EffectiveProfile {
  /**
   * `web_users.id` to use for any server-side per-user query. Null only when
   * unauthenticated.
   */
  effectiveWebUserId: string | null;
  /** Stable string for localStorage keys. Never null. */
  effectiveProfileKey: string;
  /**
   * True if writes should be allowed for the current effective profile —
   * i.e. the user is authenticated. False only for the anonymous/loading state.
   */
  canWrite: boolean;
}

export function useEffectiveProfile(): EffectiveProfile {
  const { webUserId } = useRole();
  return deriveEffectiveProfile({ webUserId });
}

/**
 * Pure helper exposed for tests + headless callers (e.g. server-side
 * seed paths that need to compute the same key without React).
 */
export function deriveEffectiveProfile(input: {
  webUserId: string | null;
}): EffectiveProfile {
  if (input.webUserId == null) {
    return {
      effectiveWebUserId: null,
      effectiveProfileKey: "anon",
      canWrite: false,
    };
  }
  return {
    effectiveWebUserId: input.webUserId,
    effectiveProfileKey: `u${input.webUserId}`,
    canWrite: true,
  };
}
