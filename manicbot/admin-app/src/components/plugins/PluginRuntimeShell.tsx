"use client";

/**
 * Shared shell for plugin runtime panels.
 *
 * Renders a manifest-driven header (icon + localized name + tagline) and an
 * optional flash banner above the runtime content. Every runtime under
 * `components/plugins/runtimes/*Runtime.tsx` should mount inside this shell so
 * the visual language stays in lock-step with the catalog detail page
 * (`PluginDetailClient`) — there is exactly one place that knows how to render
 * a plugin's identity.
 *
 * Rationale: the `/plugin/[slug]` page used to let each runtime hand-roll its
 * own header, which led to a duplicate Google Calendar SVG that looked nothing
 * like the catalog card. Centralizing the header here removes that duplication
 * and is enforced by `plugin-runtime-architecture.test.ts`.
 */

import { type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { useLang } from "../LangContext";
import { PluginIcon } from "./PluginIcon";
import { getPlugin } from "@plugins/index";
import { PLUGIN_LANGS, type PluginLang } from "@plugins/types";

export type PluginRuntimeFlash = { kind: "ok" | "err"; text: string } | null;

export interface PluginRuntimeShellProps {
  /** Plugin slug — used to look up the manifest from the registry. */
  slug: string;
  /** Optional success / error banner shown above the content card. */
  flash?: PluginRuntimeFlash;
  /** Runtime body. Wrapped in a card by default; opt out via `bare`. */
  children: ReactNode;
  /**
   * When true, children are rendered without the default rounded card. Useful
   * for grid-layout runtimes (Dark+ theme picker, Task Board kanban) that want
   * to control their own outer container.
   */
  bare?: boolean;
}

function pickLang(raw: string | null | undefined): PluginLang {
  return (PLUGIN_LANGS as readonly string[]).includes(raw ?? "")
    ? (raw as PluginLang)
    : "ru";
}

export function PluginRuntimeShell({ slug, flash = null, children, bare = false }: PluginRuntimeShellProps) {
  const { lang: rawLang } = useLang();
  const lang = pickLang(rawLang);

  const manifest = getPlugin(slug)?.manifest ?? null;
  const name = manifest?.name[lang] ?? slug;
  const tagline = manifest?.tagline[lang] ?? "";
  const iconName = manifest?.icon.name ?? "Puzzle";
  const iconTint = manifest?.icon.tint ?? "#6b7280";

  return (
    <div data-testid="plugin-runtime-shell" data-slug={slug} className="w-full max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <PluginIcon name={iconName} tint={iconTint} size={32} />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50 truncate">{name}</h2>
          {tagline ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{tagline}</p>
          ) : null}
        </div>
      </div>

      {flash ? (
        <div
          data-testid="plugin-runtime-flash"
          data-kind={flash.kind}
          role="status"
          className={`mb-4 px-4 py-3 rounded-xl text-sm flex items-start gap-2 ${
            flash.kind === "ok"
              ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 border border-emerald-200/70 dark:border-emerald-500/20"
              : "bg-rose-50 dark:bg-rose-500/10 text-rose-800 dark:text-rose-200 border border-rose-200/70 dark:border-rose-500/20"
          }`}
        >
          {flash.kind === "ok" ? (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          )}
          <span>{flash.text}</span>
        </div>
      ) : null}

      {bare ? (
        <div data-testid="plugin-runtime-content">{children}</div>
      ) : (
        <div
          data-testid="plugin-runtime-content"
          className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] p-6 shadow-sm"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Centered spinner for runtimes that gate on a tRPC query. */
export function PluginRuntimeLoading() {
  return (
    <div data-testid="plugin-runtime-loading" className="flex items-center justify-center py-10">
      <Loader2 size={20} className="animate-spin text-slate-400" />
    </div>
  );
}
