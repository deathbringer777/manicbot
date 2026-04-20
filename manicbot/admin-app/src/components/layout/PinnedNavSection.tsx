"use client";

/**
 * Pinned-plugins section — rendered at the top of the sidebar for any role.
 * Reads pinned slugs from localStorage, resolves each one to its manifest +
 * localized name + icon, and renders them as standard nav links.
 */

import Link from "next/link";
import { useMemo } from "react";
import { Star, Pin } from "lucide-react";
import { listManifests } from "@plugins/index";
import { usePinnedPlugins } from "~/lib/plugins/pinnedPlugins";
import { useLang } from "~/components/LangContext";
import { resolvePluginIcon } from "~/lib/nav/pluginNavIcons";
import { t } from "~/lib/i18n";
import type { PluginLang } from "@plugins/types";
import { PLUGIN_LANGS } from "@plugins/types";

export function PinnedNavSection({ collapsed = false }: { collapsed?: boolean }) {
  const { lang } = useLang();
  const { pinned } = usePinnedPlugins();
  const items = useMemo(() => {
    if (!pinned.length) return [];
    const pluginLang: PluginLang = (PLUGIN_LANGS as readonly string[]).includes(lang)
      ? (lang as PluginLang)
      : "ru";
    const manifests = listManifests();
    return pinned
      .map((slug) => manifests.find((m) => m.slug === slug))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .map((m) => ({
        slug: m.slug,
        href: `/plugins/${m.slug}`,
        label: m.name[pluginLang],
        Icon: resolvePluginIcon(m.icon.name),
        tint: m.icon.tint,
      }));
  }, [pinned, lang]);

  if (items.length === 0) return null;

  return (
    <div data-testid="pinned-nav-section">
      {!collapsed && (
        <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-600 inline-flex items-center gap-1">
          <Pin size={10} /> {t("plugins.pinned.header", lang)}
        </p>
      )}
      <div className="space-y-0.5">
        {items.map((item) => (
          <Link
            key={item.slug}
            href={item.href}
            data-testid="pinned-nav-item"
            data-slug={item.slug}
            className={`group flex items-center gap-3 rounded-xl px-3 py-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04] hover:text-slate-700 dark:hover:text-slate-200 ${collapsed ? "justify-center px-0" : ""}`}
            title={collapsed ? item.label : undefined}
          >
            <item.Icon className="h-[18px] w-[18px]" style={{ color: item.tint }} />
            {!collapsed && <span className="text-[13px] truncate">{item.label}</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
