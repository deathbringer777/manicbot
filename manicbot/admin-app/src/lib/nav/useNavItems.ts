"use client";

import { useMemo } from "react";
import { Puzzle, type LucideIcon } from "lucide-react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { useDashboardPrefs } from "~/lib/useDashboardPrefs";
import { api } from "~/trpc/react";
import { getPlugin } from "@plugins/index";
import type { PluginLang, PluginRole } from "@plugins/types";
import { PLUGIN_LANGS } from "@plugins/types";
import { resolvePluginIcon } from "./pluginNavIcons";
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
  // Load installed plugins (cached; no refetch storms). Skips when unauthenticated.
  const installedQ = api.plugins.getInstalled.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: !!role,
  });

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

    // ─── Inject nav contributions from installed + enabled plugins ─────
    const installs = installedQ.data ?? [];
    const injected: Array<{ href: string; icon: LucideIcon; label: string; _group?: string }> = [];
    const effectiveRoleStr = effectiveRole as PluginRole | null;
    const seenIds = new Set<string>();
    for (const row of installs) {
      if (row.enabled !== 1) continue;
      const p = getPlugin(row.pluginSlug);
      if (!p) continue;
      const navContribs = p.manifest.capabilities.nav ?? [];
      const pluginLang: PluginLang = (PLUGIN_LANGS as readonly string[]).includes(lang)
        ? (lang as PluginLang)
        : "ru";
      for (const contrib of navContribs) {
        if (seenIds.has(contrib.id)) continue;
        if (effectiveRoleStr && !contrib.roles.includes(effectiveRoleStr)) continue;
        if (contrib.requiresPersonalTenant && !isPersonalTenant) continue;
        seenIds.add(contrib.id);
        injected.push({
          href: contrib.href,
          icon: resolvePluginIcon(contrib.iconName),
          // Use plugin's own localized name if labelKey matches "self.name" convention,
          // otherwise pass through.
          label:
            contrib.labelKey === "self.name"
              ? p.manifest.name[pluginLang]
              : contrib.labelKey,
          _group: contrib.group,
        });
      }
    }

    const combined = [...resolved, ...injected];

    // Build groups
    let groups: NavGroup[];
    if (effectiveRole === "system_admin") {
      groups = NAV_GROUPS.map(g => ({
        label: tNav(g.labelKey, lang),
        items: combined.filter(r => (r as { _group?: string })._group === g.id).map(({ _group, ...item }) => item),
      })).filter(g => g.items.length > 0);
    } else {
      groups = [{ label: "", items: combined.map(({ _group, ...item }) => item) }];
    }

    const flat = groups.flatMap(g => g.items);
    const settings = resolveItem(SETTINGS_ITEM, lang);

    return { groups, flat, settings };
  }, [role, previewRole, previewMasterId, isPersonalTenant, lang, dashPrefs.hiddenTabs, installedQ.data]);
}

export { getRoleInfo } from "./navConfig";
export { tNav } from "./navLabels";
