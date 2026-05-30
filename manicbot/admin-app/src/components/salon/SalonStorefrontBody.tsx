"use client";

import { useState } from "react";
import {
  Save, Loader2, Globe, ExternalLink, AlertCircle, Instagram as InstagramIcon,
} from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { toast } from "~/lib/toast";
import { Btn } from "~/components/salon/SalonShared";
import { Switch } from "~/components/ui/Switch";

const INSTAGRAM_RE = /^https:\/\/(www\.)?instagram\.com\//i;

/**
 * Parse coordinates out of a Google Maps URL or a bare "lat, lng" string.
 * Mirrors the helper used by the public profile renderer.
 */
function parseGoogleMapsUrl(input: string): { lat: number; lng: number } | null {
  const validate = (lat: number, lng: number) =>
    isFinite(lat) && isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
      ? { lat, lng } : null;
  const atMatch = input.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (atMatch) return validate(parseFloat(atMatch[1]!), parseFloat(atMatch[2]!));
  try {
    const url = new URL(input);
    for (const key of ["q", "ll", "query"]) {
      const v = url.searchParams.get(key);
      const m = v?.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
      if (m) return validate(parseFloat(m[1]!), parseFloat(m[2]!));
    }
  } catch { /* not a URL */ }
  const bare = input.match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
  if (bare) return validate(parseFloat(bare[1]!), parseFloat(bare[2]!));
  return null;
}

const inputCls =
  "w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500";

/**
 * Body of the "Витрина / публичная страница" chip: slug, description, city,
 * Google Maps link, Instagram, and the publish toggle (with the server-side
 * NOT_READY_TO_PUBLISH readiness guard). This is the storefront content that
 * previously lived in PublicProfileEditor; the Public Profile tab is now a
 * thin preview that links back here.
 */
export function SalonStorefrontBody({ tenantId, profile }: { tenantId: string; profile: any }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const data = profile as any;

  const [slug, setSlug] = useState<string>(data?.slug ?? "");
  const [description, setDescription] = useState<string>(data?.description ?? "");
  const [city, setCity] = useState<string>(data?.city ?? "");
  const [mapsUrl, setMapsUrl] = useState<string>(
    data?.mapsUrl ?? (data?.lat != null && data?.lng != null ? `${data.lat}, ${data.lng}` : ""),
  );
  const [parsedCoords, setParsedCoords] = useState<{ lat: number; lng: number } | null>(
    data?.mapsUrl
      ? parseGoogleMapsUrl(data.mapsUrl)
      : data?.lat != null && data?.lng != null
        ? { lat: data.lat, lng: data.lng }
        : null,
  );
  const [instagramUrl, setInstagramUrl] = useState<string>(data?.instagramUrl ?? "");
  const [isPublic, setIsPublic] = useState<boolean>(!!data?.publicActive);
  const [slugError, setSlugError] = useState("");
  const [igError, setIgError] = useState("");
  const [publishError, setPublishError] = useState<string[] | null>(null);

  const servicesList = api.salon.getServices.useQuery({ tenantId });
  const slugCheck = api.salon.checkSlugAvailable.useQuery(
    { slug, tenantId },
    { enabled: slug.length > 0 && !slugError, staleTime: 5000 },
  );

  const update = api.salon.updateSalonProfile.useMutation({
    onSuccess: () => {
      utils.salon.getSalonProfile.invalidate();
      setPublishError(null);
      toast.success(t("common.saved", lang));
    },
    onError: (err) => {
      const msg = err.message ?? "";
      if (msg.startsWith("NOT_READY_TO_PUBLISH:")) {
        setPublishError(msg.replace("NOT_READY_TO_PUBLISH:", "").split(","));
        setIsPublic(false);
      } else {
        toast.error(t("common.saveError", lang), msg || undefined);
      }
    },
  });

  const MISSING_LABELS: Record<string, string> = {
    slug: t("salon.publicProfile.slugReq", lang),
    name: t("salon.publicProfile.nameReq", lang),
    services: t("salon.publicProfile.servicesReq", lang),
  };

  function validateSlug(v: string) {
    if (v && !/^[a-z0-9-]+$/.test(v)) {
      setSlugError(t("salon.publicProfile.slugError", lang));
      return false;
    }
    setSlugError("");
    return true;
  }

  function handleSave() {
    if (!validateSlug(slug)) return;
    if (instagramUrl && !INSTAGRAM_RE.test(instagramUrl)) {
      setIgError(t("salon.publicProfile.instagramError", lang));
      return;
    }
    setIgError("");
    if (isPublic) {
      const missing: string[] = [];
      if (!slug) missing.push("slug");
      if (!data?.name || !String(data.name).trim()) missing.push("name");
      if (servicesList.data && servicesList.data.length === 0) missing.push("services");
      if (missing.length) {
        setPublishError(missing);
        setIsPublic(false);
        return;
      }
    }
    setPublishError(null);
    update.mutate({
      tenantId,
      slug: slug || undefined,
      description: description || undefined,
      city: city || undefined,
      lat: parsedCoords?.lat,
      lng: parsedCoords?.lng,
      mapsUrl: mapsUrl.startsWith("http") ? mapsUrl : undefined,
      instagramUrl: instagramUrl || "",
      publicActive: isPublic ? 1 : 0,
    });
  }

  const publicUrl = slug ? `/salon/${slug}` : null;

  return (
    <div className="space-y-3">
      {/* Public URL + status */}
      {publicUrl && (
        <a
          href={publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-brand-500 dark:text-brand-400 hover:underline"
        >
          <Globe className="h-3 w-3" />
          manicbot.com{publicUrl}
          <ExternalLink className="h-3 w-3" />
        </a>
      )}

      {/* Publish toggle */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-white">{t("salon.publicProfile.showInCatalog", lang)}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t("salon.publicProfile.findInSearch", lang)}</p>
        </div>
        <Switch
          checked={isPublic}
          onChange={setIsPublic}
          aria-label={t("salon.publicProfile.showInCatalog", lang)}
          data-testid="storefront-visibility-toggle"
        />
      </div>

      {publishError && publishError.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500 dark:text-red-400 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-red-700 dark:text-red-300">{t("salon.publicProfile.cantPublish", lang)}</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-red-700/90 dark:text-red-300/90">
                {publishError.map((k) => <li key={k}>{MISSING_LABELS[k] ?? k}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-slate-200 dark:border-white/5 pt-3 space-y-3">
        {/* slug */}
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">URL slug</label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600 dark:text-slate-500 shrink-0">manicbot.com/salon/</span>
            <input
              value={slug}
              onChange={(e) => { const v = e.target.value.toLowerCase(); setSlug(v); validateSlug(v); }}
              placeholder="moj-salon-warszawa"
              className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500"
            />
            {slug && !slugError && (
              <span className={`shrink-0 text-xs font-medium ${slugCheck.data?.available === false ? "text-red-400" : slugCheck.data?.available ? "text-emerald-400" : "text-slate-500"}`}>
                {slugCheck.isLoading ? "..." : slugCheck.data?.available === false ? `❌ ${t("salon.publicProfile.taken", lang)}` : slugCheck.data?.available ? "✅" : ""}
              </span>
            )}
          </div>
          {slugError && <p className="text-xs text-red-400 mt-1">{slugError}</p>}
        </div>

        {/* city */}
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("salon.publicProfile.city", lang)}</label>
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Warszawa" className={inputCls} />
        </div>

        {/* description */}
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("common.description", lang)}</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder={t("salon.publicProfile.descriptionPlaceholder", lang)}
            className={`${inputCls} resize-none`}
          />
        </div>

        {/* maps */}
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("salon.publicProfile.mapsLabel", lang)}</label>
          <input
            value={mapsUrl}
            onChange={(e) => { setMapsUrl(e.target.value); setParsedCoords(parseGoogleMapsUrl(e.target.value)); }}
            placeholder={t("salon.publicProfile.mapsPlaceholder", lang)}
            className={inputCls}
          />
          {mapsUrl && parsedCoords && (
            <p className="text-xs text-emerald-500 mt-1">{t("salon.publicProfile.coords", lang)}: {parsedCoords.lat}, {parsedCoords.lng}</p>
          )}
          {mapsUrl && !parsedCoords && (
            <p className="text-xs text-amber-400 mt-1">{t("salon.publicProfile.coordsBad", lang)}</p>
          )}
        </div>

        {/* instagram */}
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
            <InstagramIcon className="h-3.5 w-3.5 text-pink-400" />
            {t("salon.publicProfile.instagramUrl", lang)}
          </label>
          <input
            value={instagramUrl}
            onChange={(e) => { setInstagramUrl(e.target.value); if (igError) setIgError(""); }}
            placeholder="https://instagram.com/your_salon"
            className={inputCls}
          />
          {igError && <p className="text-xs text-red-400 mt-1">{igError}</p>}
          <p className="text-[10px] text-slate-500 mt-1">{t("salon.publicProfile.instagramHint", lang)}</p>
        </div>
      </div>

      <Btn
        onClick={handleSave}
        disabled={update.isPending || !!slugError || slugCheck.data?.available === false}
        className="w-full justify-center py-2.5"
      >
        {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {t("common.save", lang)}
      </Btn>
    </div>
  );
}
