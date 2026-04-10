"use client";

import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { useDashboardPrefs } from "~/lib/useDashboardPrefs";
import { NAV_ITEMS, NAV_GROUPS, SETTINGS_ITEM, getRoleInfo, type NavItemDef } from "./navConfig";
import { tNav } from "./navLabels";

export interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

function resolveItem(def: NavItemDef, lang: string): NavItem {
  return { href: def.href, icon: def.icon, label: tNav(def.labelKey, lang) };
}

/**
 * Returns the navigation structure for the current role, filtered by:
 * - role (including preview role for system_admin)
 * - isPersonalTenant (for master services tab)
 * - hiddenTabs (from useDashboardPrefs)
 * - previewMasterId (owner delegating → show master nav)
 */
export function useNavItems(): { groups: NavGroup[]; flat: NavItem[]; settings: NavItem } {
  const { role, isPersonalTenant, previewRole, previewMasterId } = useRole();
  const { lang } = useLang();
  const { prefs: dashPrefs } = useDashboardPrefs();

  return useMemo(() => {
    // Determine effective role for navigation
    let effectiveRole = role;
    if (role === "system_admin" && previewRole && previewRole !== "system_admin") {
      effectiveRole = previewRole;
    }
    // Owner delegating to a master → show master nav
    if (effectiveRole === "tenant_owner" && previewMasterId !== null) {
      effectiveRole = "master";
    }

    // Filter items by role + personal tenant requirement
    const filtered = NAV_ITEMS.filter(item => {
      if (!effectiveRole || !item.roles.includes(effectiveRole)) return false;
      if (item.requiresPersonalTenant && !isPersonalTenant) return false;
      return true;
    });

    // Apply hidden-tab filter for tenant_owner salon items
    const visible = (effectiveRole === "tenant_owner")
      ? filtered.filter(item => {
          if (!item.hideable) return true;
          const qIdx = item.href.indexOf("?tab=");
          if (qIdx === -1) return true;
          const tab = item.href.slice(qIdx + 5);
          return !dashPrefs.hiddenTabs.includes(tab);
        })
      : filtered;

    // Resolve to NavItems with translated labels
    const resolved = visible.map(def => ({ ...resolveItem(def, lang), _group: def.group }));

    // Build groups
    let groups: NavGroup[];
    if (effectiveRole === "system_admin") {
      groups = NAV_GROUPS.map(g => ({
        label: tNav(g.labelKey, lang),
        items: resolved.filter(r => (r as any)._group === g.id).map(({ _group, ...item }) => item),
      })).filter(g => g.items.length > 0);
    } else {
      groups = [{ label: "", items: resolved.map(({ _group, ...item }) => item) }];
    }

    const flat = groups.flatMap(g => g.items);
    const settings = resolveItem(SETTINGS_ITEM, lang);

    return { groups, flat, settings };
  }, [role, previewRole, previewMasterId, isPersonalTenant, lang, dashPrefs.hiddenTabs]);
}

export { getRoleInfo } from "./navConfig";
export { tNav } from "./navLabels";
