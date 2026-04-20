/**
 * LocalStorage-backed pinned-plugins registry.
 *
 * Pinned plugins surface in a special "Закреплённые" group at the top of the
 * sidebar. Each user manages their own list; no server round-trip.
 */

import { useCallback, useEffect, useState } from "react";

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
} {
  const [pinned, setPinned] = useState<string[]>([]);

  // Hydrate from localStorage on mount
  useEffect(() => {
    setPinned(readPinned());
    const h = (e: Event) => {
      const detail = (e as CustomEvent<string[]>).detail;
      if (Array.isArray(detail)) setPinned(detail);
      else setPinned(readPinned());
    };
    window.addEventListener("manicbot:pinned-changed", h);
    window.addEventListener("storage", () => setPinned(readPinned()));
    return () => {
      window.removeEventListener("manicbot:pinned-changed", h);
    };
  }, []);

  const pin = useCallback((slug: string) => {
    const current = readPinned();
    if (current.includes(slug)) return;
    const next = [slug, ...current].slice(0, 20);
    writePinned(next);
    setPinned(next);
  }, []);

  const unpin = useCallback((slug: string) => {
    const current = readPinned();
    const next = current.filter((s) => s !== slug);
    writePinned(next);
    setPinned(next);
  }, []);

  const toggle = useCallback((slug: string) => {
    const current = readPinned();
    if (current.includes(slug)) {
      const next = current.filter((s) => s !== slug);
      writePinned(next);
      setPinned(next);
    } else {
      const next = [slug, ...current].slice(0, 20);
      writePinned(next);
      setPinned(next);
    }
  }, []);

  const isPinned = useCallback((slug: string) => pinned.includes(slug), [pinned]);

  return { pinned, isPinned, pin, unpin, toggle };
}

// Pure helpers for tests
export { readPinned, writePinned };
