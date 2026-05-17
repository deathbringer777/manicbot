"use client";

import { useRole } from "~/components/RoleContext";

/**
 * Derived "effective profile" used to scope per-user state (plugin pins,
 * dashboard prefs) on the client.
 *
 * In a regular session the effective profile is just the caller's own
 * `web_users.id`. When a tenant owner switches to «view as master»
 * preview, the effective profile shifts to that master's `web_users.id`
 * (so the preview reflects what the master would actually see).
 * Synthetic masters — those that were created salon-side and never
 * logged in (no `web_users` row) — surface as `isPreviewSynthetic=true`
 * with a null `effectiveWebUserId`; UI in that branch must NOT fall back
 * to the owner's pins (that's the bug we're fixing).
 *
 * `effectiveProfileKey` is the string suffix used in localStorage keys.
 * Format intentionally namespaced so a TEXT-id collision with the master
 * chat-id namespace can't happen:
 *   - "u<webUserId>" → web_users.id (regular or preview-of-real-master)
 *   - "m<masterChatId>" → preview of synthetic master (read-only;
 *                         writes are blocked at the UI + tRPC layer)
 *   - "anon" → no auth (rare; loading state / signed-out pages)
 */
export interface EffectiveProfile {
  /**
   * `web_users.id` to use for any server-side per-user query. Null when
   * previewing a synthetic master (then the UI MUST show an empty state
   * — never the owner's data).
   */
  effectiveWebUserId: string | null;
  /** Stable string for localStorage keys. Never null. */
  effectiveProfileKey: string;
  /** True when the active view is preview-as-master (owner viewing a master). */
  isPreview: boolean;
  /**
   * True when previewing a salon-created (synthetic) master whose
   * web_users row does not exist. The pin button must be disabled and
   * PRZYPIĘTE must render an explanatory empty state in this case.
   */
  isPreviewSynthetic: boolean;
  /**
   * True if writes should be allowed for the current effective profile.
   * - Regular view (own user) → true
   * - Preview of real master → false (owner doesn't get to modify
   *   master's pins)
   * - Preview of synthetic master → false (no target row, no destination)
   */
  canWrite: boolean;
}

export function useEffectiveProfile(): EffectiveProfile {
  const { webUserId, previewMasterId, previewMasterWebUserId } = useRole();
  return deriveEffectiveProfile({
    webUserId,
    previewMasterId,
    previewMasterWebUserId,
  });
}

/**
 * Pure helper exposed for tests + headless callers (e.g. server-side
 * seed paths that need to compute the same key without React).
 */
export function deriveEffectiveProfile(input: {
  webUserId: string | null;
  previewMasterId: number | null;
  previewMasterWebUserId: string | null;
}): EffectiveProfile {
  const isPreview = input.previewMasterId !== null;
  if (!isPreview) {
    if (input.webUserId == null) {
      return {
        effectiveWebUserId: null,
        effectiveProfileKey: "anon",
        isPreview: false,
        isPreviewSynthetic: false,
        canWrite: false,
      };
    }
    return {
      effectiveWebUserId: input.webUserId,
      effectiveProfileKey: `u${input.webUserId}`,
      isPreview: false,
      isPreviewSynthetic: false,
      canWrite: true,
    };
  }
  if (input.previewMasterWebUserId != null) {
    return {
      effectiveWebUserId: input.previewMasterWebUserId,
      effectiveProfileKey: `u${input.previewMasterWebUserId}`,
      isPreview: true,
      isPreviewSynthetic: false,
      canWrite: false,
    };
  }
  return {
    effectiveWebUserId: null,
    effectiveProfileKey: `m${input.previewMasterId}`,
    isPreview: true,
    isPreviewSynthetic: true,
    canWrite: false,
  };
}
