"use client";

import { useMemo } from "react";
import { Puzzle, type LucideIcon } from "lucide-react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { useDashboardPrefs, BOTTOM_NAV_LIMIT, applyTabPrefs } from "~/lib/useDashboardPrefs";
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
  id: string;
  label: string;
  items: NavItem[];
}

function resolveItem(def: NavItemDef, lang: string): NavItem {
  return { href: def.href, icon: def.icon, label: tNav(def.labelKey, lang) };
}

/**
 * Returns the navigation structure for the current role, filtered by:
 * - role
 * - isPersonalTenant (for master services tab)
 * - hiddenTabs (from useDashboardPrefs)
 *
 * `mobileNav` is the ordered list rendered in the mobile bottom-bar /
 * iPad-portrait bottom-bar. When `bottomNavLayout === "default"` it
 * mirrors the legacy "first 5 + Settings" slice (zero-regression
 * baseline). When `"custom"`, it honours the user's saved
 * `bottomNavOrder` — entries are filtered against the role's allowed
 * items so a hidden tab can never resurrect via a stale customisation,
 * Settings is always appended last (chrome safety — the user can't
 * lock themselves out of the only entry point to this setting), and
 * the result is hard-capped at `BOTTOM_NAV_LIMIT`.
 */
export function useNavItems(): { groups: NavGroup[]; flat: NavItem[]; settings: NavItem; mobileNav: NavItem[] } {
  const { role, isPersonalTenant } = useRole();
  const { lang } = useLang();
  const { prefs: dashPrefs } = useDashboardPrefs();
  // Load installed plugins (cached; no refetch storms). Skips when unauthenticated.
  const installedQ = api.plugins.getInstalled.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: !!role,
  });

  return useMemo(() => {
    // Determine effective role for navigation (no impersonation — own role).
    const effectiveRole = role;

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
        id: g.id,
        label: tNav(g.labelKey, lang),
        items: combined.filter(r => (r as { _group?: string })._group === g.id).map(({ _group, ...item }) => item),
      })).filter(g => g.items.length > 0);
    } else {
      // Apply user-defined pin / drag-reorder prefs. The sidebar `tab` id is
      // either parsed from the `?tab=` href fragment or the plugin nav-contrib
      // id. Plugins item is always pinned to the bottom — pinned plugins live
      // in PinnedNavSection at the very end of the sidebar (under it), per
      // user spec ("плагины всегда внизу + dropdown of pinned plugins below").
      const idOf = (item: { href: string }) => {
        const idx = item.href.indexOf("?tab=");
        if (idx !== -1) return item.href.slice(idx + 5);
        if (item.href === "/plugins") return "__plugins__";
        if (item.href === "/dashboard") return "overview";
        if (item.href === "/marketing") return "marketing";
        return item.href.replace(/^\//, "");
      };
      const itemMap = new Map(combined.map((item) => [idOf(item), item]));
      const orderedIds = applyTabPrefs(
        Array.from(itemMap.keys()).filter((id) => id !== "__plugins__"),
        {
          tabOrder: dashPrefs.tabOrder,
          pinnedTabs: dashPrefs.pinnedTabs,
          // hiddenTabs already filtered upstream, but pass empty so we don't double-filter
          hiddenTabs: [],
        },
        { applyHidden: false, alwaysVisible: ["overview"] },
      );
      // Plugins always at the bottom (per user spec)
      const ordered = orderedIds
        .map((id) => itemMap.get(id))
        .filter((x): x is NonNullable<typeof x> => !!x);
      const pluginsItem = itemMap.get("__plugins__");
      if (pluginsItem) ordered.push(pluginsItem);
      groups = [{ id: "main", label: "", items: ordered.map(({ _group, ...item }) => item) }];
    }

    const flat = groups.flatMap(g => g.items);
    const settings = resolveItem(SETTINGS_ITEM, lang);

    // ── mobileNav derivation ───────────────────────────────────────
    // Default path: legacy "first 5 + Settings" slice. Custom path:
    // honour user-supplied order, drop items the role no longer
    // exposes, append Settings if the user removed it.
    const mobileNav: NavItem[] = (() => {
      if (dashPrefs.bottomNavLayout !== "custom" || dashPrefs.bottomNavOrder.length === 0) {
        // Zero-regression slice — same logic Shell.tsx used inline.
        if (flat.length + 1 <= BOTTOM_NAV_LIMIT) {
          // All items fit including settings — show everything.
          return [...flat, settings];
        }
        const leading = flat.slice(0, Math.max(0, BOTTOM_NAV_LIMIT - 1));
        return [...leading, settings];
      }
      const flatByHref = new Map<string, NavItem>(flat.map((n) => [n.href, n]));
      const chosen: NavItem[] = [];
      const seen = new Set<string>();
      for (const href of dashPrefs.bottomNavOrder) {
        if (seen.has(href)) continue;
        const item = flatByHref.get(href);
        if (!item) continue; // role/plugin no longer exposes this tab
        seen.add(href);
        chosen.push(item);
        if (chosen.length >= BOTTOM_NAV_LIMIT) break;
      }
      // Settings is the safety belt — always present, always last,
      // never countable against BOTTOM_NAV_LIMIT for items the user
      // explicitly picked.
      if (!seen.has(settings.href)) {
        if (chosen.length >= BOTTOM_NAV_LIMIT) chosen.pop();
        chosen.push(settings);
      }
      return chosen;
    })();

    return { groups, flat, settings, mobileNav };
  }, [
    role,
    isPersonalTenant,
    lang,
    dashPrefs.hiddenTabs,
    dashPrefs.tabOrder,
    dashPrefs.pinnedTabs,
    dashPrefs.bottomNavOrder,
    dashPrefs.bottomNavLayout,
    installedQ.data,
  ]);
}

export { getRoleInfo } from "./navConfig";
export { tNav } from "./navLabels";
