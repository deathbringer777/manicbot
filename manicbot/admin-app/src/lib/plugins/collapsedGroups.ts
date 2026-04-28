/**
 * LocalStorage-backed nav group collapse state (Shopify-style collapsible sections).
 * Storage key is per-tenant so collapsing groups in salon A doesn't affect salon B.
 */

import { useCallback, useEffect, useState } from "react";
import { useRole } from "~/components/RoleContext";

const KEY_PREFIX = "manicbot_nav_collapsed_groups";

function storageKey(tenantId?: string | null): string {
  return tenantId ? `${KEY_PREFIX}_${tenantId}` : KEY_PREFIX;
}

function readCollapsed(tenantId?: string | null): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey(tenantId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

function writeCollapsed(set: Set<string>, tenantId?: string | null) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(tenantId), JSON.stringify(Array.from(set)));
    window.dispatchEvent(new CustomEvent("manicbot:nav-collapse-changed"));
  } catch {
    // noop
  }
}

export function useCollapsedGroups(): {
  isCollapsed: (groupId: string) => boolean;
  toggle: (groupId: string) => void;
} {
  const { tenantId } = useRole();
  const [state, setState] = useState<Set<string>>(new Set());

  useEffect(() => {
    setState(readCollapsed(tenantId));
    const h = () => setState(readCollapsed(tenantId));
    window.addEventListener("manicbot:nav-collapse-changed", h);
    window.addEventListener("storage", h);
    return () => {
      window.removeEventListener("manicbot:nav-collapse-changed", h);
      window.removeEventListener("storage", h);
    };
  }, [tenantId]);

  const toggle = useCallback((groupId: string) => {
    const current = readCollapsed(tenantId);
    if (current.has(groupId)) current.delete(groupId);
    else current.add(groupId);
    writeCollapsed(current, tenantId);
    setState(new Set(current));
  }, [tenantId]);

  const isCollapsed = useCallback((groupId: string) => state.has(groupId), [state]);

  return { isCollapsed, toggle };
}

export { readCollapsed, writeCollapsed, storageKey as collapsedGroupsStorageKey };
