/**
 * Server-authoritative pinned-plugins hook.
 *
 * D1 (via `plugins.listPinned` / `plugins.togglePin`) is the source of truth.
 * localStorage is kept as an optimistic cache so first paint is instant and
 * the sidebar doesn't flash empty. `CustomEvent("manicbot:pinned-changed")`
 * is preserved for any legacy listeners.
 *
 * Pins are scoped by BOTH tenant AND profile (`web_users.id`) — different
 * web-users on the same browser don't share pinned state.
 */

import { useCallback, useEffect } from "react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { useEffectiveProfile } from "~/lib/effectiveProfile";

const KEY_PREFIX = "manicbot_pinned_plugins";

/**
 * localStorage key. When `profileKey` is supplied the key is the new
 * profile-scoped format (`<prefix>_<tenant>_<profile>`); otherwise the
 * legacy tenant-only format is returned — kept around for the one-time
 * migration shim so existing users don't see an empty PRZYPIĘTE flicker
 * on first load after upgrade.
 */
function storageKey(tenantId?: string | null, profileKey?: string): string {
  if (!tenantId) return KEY_PREFIX;
  if (profileKey) return `${KEY_PREFIX}_${tenantId}_${profileKey}`;
  return `${KEY_PREFIX}_${tenantId}`;
}

function readPinned(tenantId?: string | null, profileKey?: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(tenantId, profileKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").slice(0, 20);
  } catch {
    return [];
  }
}

function writePinned(list: string[], tenantId?: string | null, profileKey?: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(tenantId, profileKey), JSON.stringify(list.slice(0, 20)));
    window.dispatchEvent(new CustomEvent("manicbot:pinned-changed", { detail: list }));
  } catch {
    // noop
  }
}

/**
 * Migration shim: when the new profile-scoped key has no value but the
 * legacy tenant-only key has one, copy it once and drop the legacy entry
 * so future writes don't bleed between web-users sharing a browser.
 *
 * Idempotent: re-running with the new key already populated is a no-op.
 * Best-effort: silently absorbs storage failures (private mode, full
 * quota, etc.) — DB is the source of truth, so worst case is one cycle
 * of optimistic-cache flicker.
 */
function migrateLegacyTenantKey(tenantId: string, profileKey: string) {
  if (typeof window === "undefined") return;
  try {
    const newKey = storageKey(tenantId, profileKey);
    const legacyKey = storageKey(tenantId);
    if (window.localStorage.getItem(newKey)) return;
    const legacyRaw = window.localStorage.getItem(legacyKey);
    if (!legacyRaw) return;
    window.localStorage.setItem(newKey, legacyRaw);
    window.localStorage.removeItem(legacyKey);
  } catch {
    // noop
  }
}

export function usePinnedPlugins(): {
  pinned: string[];
  isPinned: (slug: string) => boolean;
  pin: (slug: string) => void;
  unpin: (slug: string) => void;
  toggle: (slug: string) => void;
  /** True when writes are blocked (unauthenticated). */
  readOnly: boolean;
  error: string | null;
} {
  const { tenantId } = useRole();
  const profile = useEffectiveProfile();
  const utils = api.useUtils();

  // One-time migration on profile change. Keeps the legacy tenant-only
  // cache valid for the user who originally wrote it.
  useEffect(() => {
    if (tenantId && profile.effectiveWebUserId != null) {
      migrateLegacyTenantKey(tenantId, profile.effectiveProfileKey);
    }
  }, [tenantId, profile.effectiveWebUserId, profile.effectiveProfileKey]);

  const q = api.plugins.listPinned.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    initialData: () => {
      if (typeof window === "undefined") return undefined;
      return readPinned(tenantId, profile.effectiveProfileKey);
    },
  });

  // Mirror server truth → localStorage for next-paint seed.
  useEffect(() => {
    if (q.data) {
      writePinned(q.data, tenantId, profile.effectiveProfileKey);
    }
  }, [q.data, tenantId, profile.effectiveProfileKey]);

  const toggleMut = api.plugins.togglePin.useMutation({
    onMutate: async ({ slug }) => {
      await utils.plugins.listPinned.cancel(undefined);
      const prev = utils.plugins.listPinned.getData(undefined) ?? [];
      const next = prev.includes(slug)
        ? prev.filter((s) => s !== slug)
        : [slug, ...prev].slice(0, 20);
      utils.plugins.listPinned.setData(undefined, next);
      writePinned(next, tenantId, profile.effectiveProfileKey);
      return { prev };
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.prev) {
        utils.plugins.listPinned.setData(undefined, ctx.prev);
        writePinned(ctx.prev, tenantId, profile.effectiveProfileKey);
      }
    },
    onSettled: () => {
      void utils.plugins.listPinned.invalidate(undefined);
    },
  });

  const pinned = q.data ?? [];
  const readOnly = !profile.canWrite;

  const toggle = useCallback(
    (slug: string) => {
      if (readOnly) return; // UI guards too — defence in depth
      toggleMut.mutate({ slug });
    },
    [readOnly, toggleMut],
  );
  const pin = useCallback(
    (slug: string) => {
      if (readOnly) return;
      if (!pinned.includes(slug)) toggleMut.mutate({ slug });
    },
    [readOnly, pinned, toggleMut],
  );
  const unpin = useCallback(
    (slug: string) => {
      if (readOnly) return;
      if (pinned.includes(slug)) toggleMut.mutate({ slug });
    },
    [readOnly, pinned, toggleMut],
  );
  const isPinned = useCallback((slug: string) => pinned.includes(slug), [pinned]);

  return {
    pinned,
    isPinned,
    pin,
    unpin,
    toggle,
    readOnly,
    error: toggleMut.error?.message ?? null,
  };
}

// Pure helpers retained for existing tests / cache seeding
export { readPinned, writePinned, storageKey as pinnedStorageKey };
