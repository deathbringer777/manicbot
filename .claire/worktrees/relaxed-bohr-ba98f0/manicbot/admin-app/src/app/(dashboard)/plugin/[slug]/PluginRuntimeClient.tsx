"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { hasRuntime, loadRuntime } from "~/components/plugins/runtimePanels";
import { PluginIcon } from "~/components/plugins/PluginIcon";

export default function PluginRuntimeClient() {
  const params = useParams();
  const slug = String(params?.slug ?? "");
  const { lang } = useLang();
  const router = useRouter();

  const catalogQ = api.plugins.listCatalog.useQuery({ lang });
  const card = (catalogQ.data ?? []).find((c) => c.slug === slug);

  if (catalogQ.isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-slate-400" />
      </div>
    );
  }

  // Not installed+enabled → redirect to management page
  if (!card || !card.installed || !card.enabled) {
    router.replace(`/plugins/${slug}`);
    return null;
  }

  // No runtime component → redirect to management page
  if (!hasRuntime(slug)) {
    router.replace(`/plugins/${slug}`);
    return null;
  }

  const RuntimeComponent = loadRuntime(slug);
  if (!RuntimeComponent || !card.installationId) {
    router.replace(`/plugins/${slug}`);
    return null;
  }

  return (
    <div className="min-h-0 flex flex-col max-w-4xl mx-auto w-full px-4 sm:px-6 pt-5 pb-10">
      {/* Back to dashboard */}
      <Link
        href="/"
        className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 inline-flex items-center gap-1.5 self-start"
      >
        <ArrowLeft size={14} /> {t("plugins.detail.back", lang)}
      </Link>

      {/* Header: icon + name + subtle Manage link */}
      <header className="mt-4 flex items-center gap-3 flex-wrap">
        <PluginIcon name={card.iconName} tint={card.iconTint} size={28} />
        <h1 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-slate-100 flex-1 min-w-0 truncate">
          {card.name}
        </h1>
        <Link
          href={`/plugins/${slug}`}
          data-testid="plugin-runtime-manage-link"
          className="text-xs text-slate-400 dark:text-slate-500 hover:text-brand-500 dark:hover:text-brand-400 inline-flex items-center gap-1 shrink-0"
        >
          <ExternalLink size={11} /> {t("plugins.runtime.manage", lang)}
        </Link>
      </header>

      {/* Runtime working area */}
      <section className="mt-6" data-testid="plugin-runtime-area">
        <RuntimeComponent installationId={card.installationId} slug={slug} />
      </section>
    </div>
  );
}
