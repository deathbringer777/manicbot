"use client";

import { useState, useEffect } from "react";
import {
  Pencil, X, Save, Loader2, Plus, Globe, ExternalLink, MapPin,
  ToggleLeft, ToggleRight, AlertCircle,
} from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { SectionHeader, Btn } from "~/components/salon/SalonShared";

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

export function PublicProfileEditor({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const profile = api.salon.getSalonProfile.useQuery({ tenantId });
  const servicesList = api.salon.getServices.useQuery({ tenantId });
  const [publishError, setPublishError] = useState<string[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [city, setCity] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [parsedCoords, setParsedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [slugError, setSlugError] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [newPhotoUrl, setNewPhotoUrl] = useState("");

  const data = profile.data as any;

  useEffect(() => {
    if (data && !editing) {
      setSlug(data.slug ?? "");
      setDescription(data.description ?? "");
      setCity(data.city ?? "");
      if (data.mapsUrl) {
        setMapsUrl(data.mapsUrl);
        setParsedCoords(parseGoogleMapsUrl(data.mapsUrl));
      } else if (data.lat != null && data.lng != null) {
        setMapsUrl(`${data.lat}, ${data.lng}`);
        setParsedCoords({ lat: data.lat, lng: data.lng });
      } else {
        setMapsUrl("");
        setParsedCoords(null);
      }
      setIsPublic(!!data.publicActive);
      setPhotos(Array.isArray(data.photos) ? data.photos : []);
    }
  }, [data, editing]);

  const update = api.salon.updateSalonProfile.useMutation({
    onSuccess: () => {
      utils.salon.getSalonProfile.invalidate();
      setEditing(false);
      setPublishError(null);
    },
    onError: (err) => {
      const msg = err.message ?? "";
      if (msg.startsWith("NOT_READY_TO_PUBLISH:")) {
        setPublishError(msg.replace("NOT_READY_TO_PUBLISH:", "").split(","));
        setIsPublic(false);
      }
    },
  });

  const readinessMissing: string[] = [];
  if (!data?.slug) readinessMissing.push("slug");
  if (!data?.name || !String(data.name).trim()) readinessMissing.push("name");
  if (servicesList.data && servicesList.data.length === 0) readinessMissing.push("services");
  const isReadyToPublish = readinessMissing.length === 0;

  const MISSING_LABELS: Record<string, string> = {
    slug: t("salon.publicProfile.slugReq", lang),
    name: t("salon.publicProfile.nameReq", lang),
    services: t("salon.publicProfile.servicesReq", lang),
  };

  const slugCheck = api.salon.checkSlugAvailable.useQuery(
    { slug, tenantId },
    { enabled: editing && slug.length > 0 && !slugError, staleTime: 5000 },
  );

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
      publicActive: isPublic ? 1 : 0,
      photos,
    });
  }

  function addPhoto() {
    const url = newPhotoUrl.trim();
    if (!url) return;
    setPhotos((prev) => [...prev, url]);
    setNewPhotoUrl("");
  }

  const publicUrl = slug ? `/salon/${slug}` : null;

  if (profile.isLoading) return <Loader2 className="animate-spin text-brand-400 mx-auto mt-8" />;
  if (profile.isError) return <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">{t("common.errorLoading", lang)}</p></div>;

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("salon.publicProfile.title", lang)}
        action={editing
          ? <Btn variant="ghost" onClick={() => setEditing(false)}><X className="h-3.5 w-3.5" />{t("common.cancel", lang)}</Btn>
          : <Btn onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" />{t("common.edit", lang)}</Btn>
        }
      />

      <div className={`rounded-xl p-4 flex items-center gap-3 ${isPublic ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700"}`}>
        {isPublic
          ? <ToggleRight className="h-6 w-6 text-emerald-400 shrink-0" />
          : <ToggleLeft className="h-6 w-6 text-slate-500 shrink-0" />}
        <div className="flex-1">
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
        {!editing && (
          <button onClick={() => {
            const newVal = isPublic ? 0 : 1;
            if (newVal === 1 && !isReadyToPublish) {
              setPublishError(readinessMissing);
              return;
            }
            setPublishError(null);
            setIsPublic(!!newVal);
            update.mutate({ tenantId, publicActive: newVal });
          }}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${isPublic ? "bg-red-500/15 text-red-400 hover:bg-red-500/25" : "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"}`}>
            {isPublic ? t("salon.publicProfile.hide", lang) : t("salon.publicProfile.publish", lang)}
          </button>
        )}
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
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setEditing(true)}
                  className="rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-500/30 dark:text-red-200"
                >
                  {t("salon.publicProfile.editProfile", lang)}
                </button>
                <button
                  onClick={() => setPublishError(null)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-700/70 transition hover:text-red-700 dark:text-red-300/70 dark:hover:text-red-300"
                >
                  {t("common.close", lang)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!editing ? (
        <div className="glass-card rounded-2xl p-4 space-y-3">
          {[
            { label: "URL (slug)", value: data?.slug, icon: Globe },
            { label: t("salon.publicProfile.city", lang), value: data?.city, icon: MapPin },
            { label: t("common.description", lang), value: data?.description, icon: null },
            { label: t("salon.publicProfile.coords", lang), value: (data?.lat && data?.lng) ? `${data.lat}, ${data.lng}` : null, icon: null },
          ].map(({ label, value, icon: Icon }) => value ? (
            <div key={label} className="flex items-start gap-3">
              {Icon ? <Icon className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" /> : <div className="w-4 shrink-0" />}
              <div>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-sm text-slate-900 dark:text-white">{value}</p>
              </div>
            </div>
          ) : null)}
          {(data?.logo || data?.coverPhoto) && (
            <div className="flex gap-3 border-t border-slate-200 dark:border-white/5 pt-3">
              {data.logo && <img src={data.logo} alt="logo" className="h-12 w-12 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />}
              {data.coverPhoto && <img src={data.coverPhoto} alt="cover" className="h-12 flex-1 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />}
            </div>
          )}
          {photos.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-2">{t("salon.publicProfile.gallerySimple", lang)} ({photos.length})</p>
              <div className="flex flex-wrap gap-2">
                {photos.map((url, i) => (
                  <img key={i} src={url} alt="" className="h-16 w-16 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
                ))}
              </div>
            </div>
          )}
          {!data?.slug && (
            <p className="text-xs text-amber-400/80 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" />
              {t("salon.publicProfile.setSlugFirst", lang)}
            </p>
          )}
        </div>
      ) : (
        <div className="glass-card rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">{t("salon.publicProfile.showInCatalog", lang)}</p>
              <p className="text-xs text-slate-500">{t("salon.publicProfile.findInSearch", lang)}</p>
            </div>
            <button onClick={() => setIsPublic((v) => !v)}
              className={`relative h-6 w-11 rounded-full transition-colors ${isPublic ? "bg-brand-500" : "bg-slate-300 dark:bg-slate-700"}`}>
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${isPublic ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>

          <div className="border-t border-slate-200 dark:border-white/5 pt-3 space-y-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">URL slug</label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600 dark:text-slate-500 shrink-0">manicbot.com/salon/</span>
                <input value={slug} onChange={(e) => { setSlug(e.target.value.toLowerCase()); validateSlug(e.target.value.toLowerCase()); }}
                  placeholder="moj-salon-warszawa"
                  className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
                {slug && !slugError && (
                  <span className={`shrink-0 text-xs font-medium ${slugCheck.data?.available === false ? "text-red-400" : slugCheck.data?.available ? "text-emerald-400" : "text-slate-500"}`}>
                    {slugCheck.isLoading ? "..." : slugCheck.data?.available === false ? `❌ ${t("salon.publicProfile.taken", lang)}` : slugCheck.data?.available ? "✅" : ""}
                  </span>
                )}
              </div>
              {slugError && <p className="text-xs text-red-400 mt-1">{slugError}</p>}
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("salon.publicProfile.city", lang)}</label>
              <input value={city} onChange={(e) => setCity(e.target.value)}
                placeholder="Warszawa"
                className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("common.description", lang)}</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                rows={3} placeholder={t("salon.publicProfile.descriptionPlaceholder", lang)}
                className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500 resize-none" />
            </div>

            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("salon.publicProfile.mapsLabel", lang)}</label>
              <input value={mapsUrl} onChange={(e) => { setMapsUrl(e.target.value); setParsedCoords(parseGoogleMapsUrl(e.target.value)); }}
                placeholder={t("salon.publicProfile.mapsPlaceholder", lang)}
                className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
              {mapsUrl && parsedCoords && (
                <p className="text-xs text-emerald-500 mt-1">{t("salon.publicProfile.coords", lang)}: {parsedCoords.lat}, {parsedCoords.lng}</p>
              )}
              {mapsUrl && !parsedCoords && (
                <p className="text-xs text-amber-400 mt-1">{t("salon.publicProfile.coordsBad", lang)}</p>
              )}
            </div>

            <div className="border-t border-slate-200 dark:border-white/5 pt-3">
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-2 block">{t("salon.publicProfile.gallery", lang)} ({photos.length})</label>
              {photos.length > 0 && (
                <div className="space-y-2 mb-3">
                  {photos.map((url, i) => (
                    <div key={i} className="flex items-center gap-2 group">
                      <img src={url} alt="" className="h-12 w-12 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0" />
                      <span className="flex-1 text-xs text-slate-500 truncate">{url}</span>
                      <div className="flex gap-1 shrink-0">
                        <button type="button" disabled={i === 0}
                          onClick={() => setPhotos((prev) => { const a = [...prev]; const t = a[i-1]!; a[i-1] = a[i]!; a[i] = t; return a; })}
                          className="h-6 w-6 flex items-center justify-center rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 hover:bg-slate-300 dark:hover:bg-slate-600">
                          ↑
                        </button>
                        <button type="button" disabled={i === photos.length - 1}
                          onClick={() => setPhotos((prev) => { const a = [...prev]; const t = a[i+1]!; a[i+1] = a[i]!; a[i] = t; return a; })}
                          className="h-6 w-6 flex items-center justify-center rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 hover:bg-slate-300 dark:hover:bg-slate-600">
                          ↓
                        </button>
                        <button type="button"
                          onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                          className="h-6 w-6 flex items-center justify-center rounded bg-red-500/10 text-red-400 hover:bg-red-500/20">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={newPhotoUrl}
                  onChange={(e) => setNewPhotoUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPhoto())}
                  placeholder="https://example.com/photo.jpg"
                  className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500"
                />
                <button type="button" onClick={addPhoto}
                  className="shrink-0 rounded-lg bg-slate-200 dark:bg-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 flex items-center gap-1">
                  <Plus className="h-3.5 w-3.5" />
                  {t("common.add", lang)}
                </button>
              </div>
            </div>
          </div>

          <Btn onClick={handleSave} disabled={update.isPending || !!slugError || slugCheck.data?.available === false} className="w-full justify-center py-2.5">
            {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("salon.publicProfile.savePublic", lang)}
          </Btn>
        </div>
      )}
    </div>
  );
}
