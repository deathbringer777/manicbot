"use client";

/**
 * Plugin tabs in the sidebar.
 *
 * Browser-tab metaphor:
 *  - Pinned plugins (persisted via plugins.togglePin → plugin_pins table) render
 *    as standard nav links with a hover-only Unpin button.
 *  - The currently open plugin (URL = /plugin/<slug>) appears as a transient
 *    row above the pinned list when it isn't already pinned. It carries an
 *    always-visible Pin button so the user can promote it to persistent.
 *
 * Both row types receive the standard NavLink accent active highlight when
 * the pathname matches their href, so they visually rhyme with the rest of
 * the sidebar.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { Pin, PinOff } from "lucide-react";
import { listManifests } from "@plugins/index";
import { hasRuntime } from "~/components/plugins/runtimePanels";
import { usePinnedPlugins } from "~/lib/plugins/pinnedPlugins";
import { useLang } from "~/components/LangContext";
import { resolvePluginIcon } from "~/lib/nav/pluginNavIcons";
import { t } from "~/lib/i18n";
import type { PluginLang } from "@plugins/types";
import { PLUGIN_LANGS } from "@plugins/types";

/** Anchored regex: captures slug from /plugin/<slug>, ignores query+hash, refuses /plugins/<slug>. */
const PLUGIN_PATH_RE = /^\/plugin\/([^/?#]+)/;

const ACTIVE_CLASSES =
  "bg-accent-500/10 dark:bg-accent-500/15 text-accent-700 dark:text-accent-400 font-semibold border-l-[3px] border-accent-500 dark:border-accent-400";
const INACTIVE_CLASSES =
  "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04] hover:text-slate-700 dark:hover:text-slate-200 border-l-[3px] border-transparent";

export function PinnedNavSection({
  collapsed = false,
  showEmpty = false,
}: {
  collapsed?: boolean;
  /** Render a dashed empty-state hint (with CTA to /plugins) when no pins exist. Desktop-only. */
  showEmpty?: boolean;
}) {
  const { lang } = useLang();
  const pathname = usePathname();
  const { pinned, pin, unpin } = usePinnedPlugins();

  const pluginLang: PluginLang = (PLUGIN_LANGS as readonly string[]).includes(lang)
    ? (lang as PluginLang)
    : "ru";

  const pinnedItems = useMemo(() => {
    if (!pinned.length) return [];
    const manifests = listManifests();
    return pinned
      .map((slug) => manifests.find((m) => m.slug === slug))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .map((m) => ({
        slug: m.slug,
        href: `/plugin/${m.slug}`,
        label: m.name[pluginLang],
        Icon: resolvePluginIcon(m.icon.name),
        tint: m.icon.tint,
      }));
  }, [pinned, pluginLang]);

  const transientItem = useMemo(() => {
    if (!pathname) return null;
    const match = PLUGIN_PATH_RE.exec(pathname);
    if (!match) return null;
    const slug = match[1];
    if (!slug) return null;
    if (pinned.includes(slug)) return null;
    if (!hasRuntime(slug)) return null;
    const manifest = listManifests().find((m) => m.slug === slug);
    if (!manifest) return null;
    return {
      slug: manifest.slug,
      href: `/plugin/${manifest.slug}`,
      label: manifest.name[pluginLang],
      Icon: resolvePluginIcon(manifest.icon.name),
      tint: manifest.icon.tint,
    };
  }, [pathname, pinned, pluginLang]);

  // Empty state: no pins AND no transient → optionally show the dashed CTA card.
  if (pinnedItems.length === 0 && !transientItem) {
    if (!showEmpty || collapsed) return null;
    return (
      <div data-testid="pinned-nav-empty" className="mx-1 mb-1 rounded-xl border border-dashed border-slate-200 dark:border-white/10 px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-600 inline-flex items-center gap-1">
          <Pin size={10} /> {t("plugins.pinned.header", lang)}
        </p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 leading-snug">
          {t("plugins.pinned.emptyHint", lang)}{" "}
          <Link href="/plugins" className="text-brand-500 hover:underline">
            {t("plugins.pinned.emptyCta", lang)}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div data-testid="pinned-nav-section">
      {/* Transient open-plugin row — appears above the pinned header. */}
      {transientItem && (
        <div
          className={`group relative flex items-center rounded-xl ${collapsed ? "justify-center" : ""}`}
        >
          <Link
            href={transientItem.href}
            data-testid="open-plugin-nav-item"
            data-slug={transientItem.slug}
            className={`flex flex-1 items-center gap-3 rounded-xl px-3 py-2 ${ACTIVE_CLASSES} ${collapsed ? "justify-center px-0 border-l-0" : "pr-7"}`}
            title={collapsed ? transientItem.label : undefined}
          >
            <transientItem.Icon className="h-[18px] w-[18px] shrink-0 opacity-80" style={{ color: transientItem.tint }} />
            {!collapsed && (
              <span className="text-[13px] truncate italic">{transientItem.label}</span>
            )}
          </Link>
          {!collapsed && (
            <button
              type="button"
              onClick={() => pin(transientItem.slug)}
              title={t("plugins.pin", lang)}
              className="absolute right-2 p-0.5 rounded text-accent-600 dark:text-accent-400 hover:text-accent-700 dark:hover:text-accent-300"
            >
              <Pin size={12} />
            </button>
          )}
        </div>
      )}

      {pinnedItems.length > 0 && !collapsed && (
        <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-600 inline-flex items-center gap-1">
          <Pin size={10} /> {t("plugins.pinned.header", lang)}
        </p>
      )}
      <div className="space-y-0.5">
        {pinnedItems.map((item) => {
          const active = pathname === item.href;
          return (
            <div
              key={item.slug}
              className={`group relative flex items-center rounded-xl ${collapsed ? "justify-center" : ""}`}
            >
              <Link
                href={item.href}
                data-testid="pinned-nav-item"
                data-slug={item.slug}
                className={`flex flex-1 items-center gap-3 rounded-xl px-3 py-2 ${active ? ACTIVE_CLASSES : INACTIVE_CLASSES} ${collapsed ? "justify-center px-0 border-l-0" : "pr-7"}`}
                title={collapsed ? item.label : undefined}
              >
                <item.Icon className="h-[18px] w-[18px] shrink-0" style={{ color: item.tint }} />
                {!collapsed && <span className="text-[13px] truncate">{item.label}</span>}
              </Link>
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => unpin(item.slug)}
                  title={t("plugins.unpin", lang)}
                  className="absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <PinOff size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
