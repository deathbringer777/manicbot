/**
 * LocalStorage-backed nav group collapse state (Shopify-style collapsible sections).
 */

import { useCallback, useEffect, useState } from "react";

const KEY = "manicbot_nav_collapsed_groups";

function readCollapsed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

function writeCollapsed(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(Array.from(set)));
    window.dispatchEvent(new CustomEvent("manicbot:nav-collapse-changed"));
  } catch {
    // noop
  }
}

export function useCollapsedGroups(): {
  isCollapsed: (groupId: string) => boolean;
  toggle: (groupId: string) => void;
} {
  const [state, setState] = useState<Set<string>>(new Set());

  useEffect(() => {
    setState(readCollapsed());
    const h = () => setState(readCollapsed());
    window.addEventListener("manicbot:nav-collapse-changed", h);
    window.addEventListener("storage", h);
    return () => {
      window.removeEventListener("manicbot:nav-collapse-changed", h);
      window.removeEventListener("storage", h);
    };
  }, []);

  const toggle = useCallback((groupId: string) => {
    const current = readCollapsed();
    if (current.has(groupId)) current.delete(groupId);
    else current.add(groupId);
    writeCollapsed(current);
    setState(new Set(current));
  }, []);

  const isCollapsed = useCallback((groupId: string) => state.has(groupId), [state]);

  return { isCollapsed, toggle };
}

export { readCollapsed, writeCollapsed };
