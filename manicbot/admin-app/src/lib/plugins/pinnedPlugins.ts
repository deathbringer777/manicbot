/**
 * Server-authoritative pinned-plugins hook.
 *
 * D1 (via `plugins.listPinned` / `plugins.togglePin`) is the source of truth.
 * localStorage is kept as an optimistic cache so first paint is instant and
 * the sidebar doesn't flash empty. `CustomEvent("manicbot:pinned-changed")`
 * is preserved for any legacy listeners.
 */

import { useCallback, useEffect } from "react";
import { api } from "~/trpc/react";

const KEY = "manicbot_pinned_plugins";

function readPinned(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").slice(0, 20);
  } catch {
    return [];
  }
}

function writePinned(list: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20)));
    window.dispatchEvent(new CustomEvent("manicbot:pinned-changed", { detail: list }));
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
  error: string | null;
} {
  const utils = api.useUtils();
  const q = api.plugins.listPinned.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    initialData: () => (typeof window !== "undefined" ? readPinned() : undefined),
  });

  // Mirror server truth → localStorage for next-paint seed
  useEffect(() => {
    if (q.data) writePinned(q.data);
  }, [q.data]);

  const toggleMut = api.plugins.togglePin.useMutation({
    onMutate: async ({ slug }) => {
      await utils.plugins.listPinned.cancel();
      const prev = utils.plugins.listPinned.getData() ?? [];
      const next = prev.includes(slug)
        ? prev.filter((s) => s !== slug)
        : [slug, ...prev].slice(0, 20);
      utils.plugins.listPinned.setData(undefined, next);
      writePinned(next);
      return { prev };
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.prev) {
        utils.plugins.listPinned.setData(undefined, ctx.prev);
        writePinned(ctx.prev);
      }
    },
    onSettled: () => {
      void utils.plugins.listPinned.invalidate();
    },
  });

  const pinned = q.data ?? [];

  const toggle = useCallback(
    (slug: string) => {
      toggleMut.mutate({ slug });
    },
    [toggleMut],
  );
  const pin = useCallback(
    (slug: string) => {
      if (!pinned.includes(slug)) toggleMut.mutate({ slug });
    },
    [pinned, toggleMut],
  );
  const unpin = useCallback(
    (slug: string) => {
      if (pinned.includes(slug)) toggleMut.mutate({ slug });
    },
    [pinned, toggleMut],
  );
  const isPinned = useCallback((slug: string) => pinned.includes(slug), [pinned]);

  return {
    pinned,
    isPinned,
    pin,
    unpin,
    toggle,
    error: toggleMut.error?.message ?? null,
  };
}

// Pure helpers retained for existing tests / cache seeding
export { readPinned, writePinned };
