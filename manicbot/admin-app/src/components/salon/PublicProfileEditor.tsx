"use client";

import { useState } from "react";
import {
  Loader2, Globe, ExternalLink, MapPin, ToggleLeft, ToggleRight, AlertCircle, Pencil,
} from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

/**
 * Public profile = a thin **preview + publish** surface.
 *
 * Field editing (slug, description, city, map, photos, branding, hours) now
 * lives in the «Мой салон» tab as collapsible chips. This view shows the public
 * URL, the publish toggle (with the same NOT_READY_TO_PUBLISH readiness guard),
 * a read-only preview of the catalog card, and a link back to «Мой салон».
 */
export function PublicProfileEditor({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const profile = api.salon.getSalonProfile.useQuery({ tenantId });
  const servicesList = api.salon.getServices.useQuery({ tenantId });
  const [publishError, setPublishError] = useState<string[] | null>(null);

  const data = profile.data as any;

  const update = api.salon.updateSalonProfile.useMutation({
    onSuccess: () => {
      utils.salon.getSalonProfile.invalidate();
      setPublishError(null);
    },
    onError: (err) => {
      const msg = err.message ?? "";
      if (msg.startsWith("NOT_READY_TO_PUBLISH:")) {
        setPublishError(msg.replace("NOT_READY_TO_PUBLISH:", "").split(","));
      }
    },
  });

  const readinessMissing: string[] = [];
  if (!data?.slug) readinessMissing.push("slug");
  if (!data?.name || !String(data.name).trim()) readinessMissing.push("name");
  if (servicesList.data && servicesList.data.length === 0) readinessMissing.push("services");
  const isReadyToPublish = readinessMissing.length === 0;
  const isPublic = !!data?.publicActive;

  const MISSING_LABELS: Record<string, string> = {
    slug: t("salon.publicProfile.slugReq", lang),
    name: t("salon.publicProfile.nameReq", lang),
    services: t("salon.publicProfile.servicesReq", lang),
  };

  const slug = data?.slug as string | null;
  const publicUrl = slug ? `/salon/${slug}` : null;
  const photos: string[] = Array.isArray(data?.photos) ? data.photos : [];

  if (profile.isLoading) return <Loader2 className="animate-spin text-brand-400 mx-auto mt-8" />;
  if (profile.isError) {
    return (
      <div className="glass-card rounded-2xl p-6 text-center">
        <p className="text-red-400">{t("common.errorLoading", lang)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status + publish toggle */}
      <div className={`rounded-xl p-4 flex items-center gap-3 ${isPublic ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700"}`}>
        {isPublic
          ? <ToggleRight className="h-6 w-6 text-emerald-400 shrink-0" />
          : <ToggleLeft className="h-6 w-6 text-slate-500 shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${isPublic ? "text-emerald-300" : "text-slate-500 dark:text-slate-400"}`}>
            {isPublic ? t("salon.publicProfile.visibleInCatalog", lang) : t("salon.publicProfile.hiddenFromCatalog", lang)}
          </p>
          {publicUrl && (
            <a href={publicUrl} target="_blank" rel="noopener noreferrer"
              className="mt-0.5 flex items-center gap-1 text-xs text-brand-400 hover:underline">
              <Globe className="h-3 w-3" />
              manicbot.com{publicUrl}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <button
          onClick={() => {
            const newVal = isPublic ? 0 : 1;
            if (newVal === 1 && !isReadyToPublish) {
              setPublishError(readinessMissing);
              return;
            }
            setPublishError(null);
            update.mutate({ tenantId, publicActive: newVal });
          }}
          disabled={update.isPending}
          className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${isPublic ? "bg-red-500/15 text-red-400 hover:bg-red-500/25" : "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"}`}
        >
          {isPublic ? t("salon.publicProfile.hide", lang) : t("salon.publicProfile.publish", lang)}
        </button>
      </div>

      {publishError && publishError.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-500 dark:text-red-400" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                {t("salon.publicProfile.cantPublish", lang)}
              </p>
              <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-red-700/90 dark:text-red-300/90">
                {publishError.map((k) => (
                  <li key={k}>{MISSING_LABELS[k] ?? k}</li>
                ))}
              </ul>
              <a
                href="/settings?section=salon"
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-500/30 dark:text-red-200"
              >
                <Pencil className="h-3.5 w-3.5" />
                {t("salon.publicProfile.openMySalon", lang)}
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Read-only preview of the catalog card */}
      <div className="glass-card rounded-2xl p-4">
        <div className="space-y-3">
          {(() => {
            const rows = [
              { label: "URL (slug)", value: data?.slug, icon: Globe },
              { label: t("salon.publicProfile.city", lang), value: data?.city, icon: MapPin },
              { label: t("common.description", lang), value: data?.description, icon: null },
              { label: t("salon.publicProfile.coords", lang), value: (data?.lat && data?.lng) ? `${data.lat}, ${data.lng}` : null, icon: null },
            ];
            const filled = rows.filter((r) => r.value);
            if (filled.length === 0) {
              return (
                <p className="text-sm text-slate-500 dark:text-slate-400 py-2">
                  {t("salon.publicProfile.setSlugFirst", lang)}
                </p>
              );
            }
            return filled.map(({ label, value, icon: Icon }) => (
              <div key={label} className="flex items-start gap-3">
                {Icon ? <Icon className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" /> : <div className="w-4 shrink-0" />}
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="text-sm text-slate-900 dark:text-white break-words">{value}</p>
                </div>
              </div>
            ));
          })()}
          {(data?.logo || data?.coverPhoto) && (
            <div className="flex gap-3 border-t border-slate-200 dark:border-white/5 pt-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {data.logo && <img src={data.logo} alt="logo" className="h-12 w-12 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {data.coverPhoto && <img src={data.coverPhoto} alt="cover" className="h-12 flex-1 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />}
            </div>
          )}
          {photos.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-2">{t("salon.publicProfile.gallerySimple", lang)} ({photos.length})</p>
              <div className="flex flex-wrap gap-2">
                {photos.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={url} alt="" className="h-16 w-16 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="mt-4 pt-3 border-t border-slate-200 dark:border-white/5 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{t("salon.publicProfile.editedInMySalon", lang)}</p>
          <a
            href="/settings?section=salon"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-3 py-1.5 text-xs font-medium text-white border border-brand-600 hover:bg-brand-600 shadow-sm"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t("salon.publicProfile.openMySalon", lang)}
          </a>
        </div>
      </div>
    </div>
  );
}
