"use client";

import { useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { hasRuntime, loadRuntime } from "~/components/plugins/runtimePanels";

export default function PluginOpenClient() {
  const params = useParams();
  const slug = String(params?.slug ?? "");
  const router = useRouter();
  const { lang } = useLang();

  const installedQ = api.plugins.getInstalled.useQuery();
  const installation = useMemo(() => {
    if (!installedQ.data) return null;
    return installedQ.data.find((row) => row.pluginSlug === slug) ?? null;
  }, [installedQ.data, slug]);

  const runtimeAvailable = hasRuntime(slug);

  // Redirect when: not installed / disabled / no runtime (once data is loaded).
  useEffect(() => {
    if (installedQ.isLoading) return;
    const needsRedirect =
      !installation ||
      !installation.enabled || // 0 means disabled in SQLite
      !runtimeAvailable;
    if (needsRedirect) {
      router.replace(`/plugins/${slug}`);
    }
  }, [installedQ.isLoading, installation, runtimeAvailable, router, slug]);

  // Loading state
  if (installedQ.isLoading || !installedQ.data) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-slate-400" />
      </div>
    );
  }

  // Redirect in progress (or edge case where redirect didn't fire yet)
  if (!installation || !installation.enabled /* 0 = disabled */ || !runtimeAvailable) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-slate-400" />
      </div>
    );
  }

  const RuntimeComponent = loadRuntime(slug);
  if (!RuntimeComponent) {
    // Should not happen (guarded by runtimeAvailable above), but TypeScript
    router.replace(`/plugins/${slug}`);
    return null;
  }

  return (
    <div className="min-h-0 flex flex-col w-full max-w-6xl mx-auto px-4 sm:px-6 pt-4 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      {/* Single back-link — the runtime's PluginRuntimeShell renders the
          icon + name + tagline header, so we don't repeat the name here. */}
      <div className="mb-4">
        <Link
          href="/plugins"
          className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 inline-flex items-center gap-1"
        >
          <ArrowLeft size={13} /> {t("plugins.detail.back", lang)}
        </Link>
      </div>

      {/* Runtime full-width area */}
      <div data-testid="plugin-runtime-area">
        <RuntimeComponent installationId={installation.id} slug={slug} />
      </div>
    </div>
  );
}
