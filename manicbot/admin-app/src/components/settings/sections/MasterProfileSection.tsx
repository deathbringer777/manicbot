"use client";

import { useState, useEffect } from "react";
import { Loader2, Pencil, X, Save, Plus } from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

export function MasterProfileSection() {
  const { lang } = useLang();
  const { tenantId, userId } = useRole();
  const utils = api.useUtils();

  if (!tenantId || !userId) {
    return (
      <div className="glass-card rounded-2xl p-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("common.noTenant", lang)}</p>
      </div>
    );
  }

  const masterId = userId;
  const profile = api.master.getMyProfile.useQuery({ tenantId, masterId });
  const updateProfile = api.master.updateProfile.useMutation({
    onSuccess: () => { utils.master.getMyProfile.invalidate(); setBioEdit(false); },
  });

  const [bioEdit, setBioEdit] = useState(false);
  const [bio, setBio] = useState("");
  const [portfolio, setPortfolio] = useState<string[]>([]);
  const [newPortfolioUrl, setNewPortfolioUrl] = useState("");

  useEffect(() => {
    if (profile.data) {
      setBio((profile.data as any).bio ?? "");
      setPortfolio(Array.isArray((profile.data as any).portfolio) ? (profile.data as any).portfolio : []);
    }
  }, [profile.data]);

  if (profile.isLoading) {
    return <Loader2 className="animate-spin text-brand-400 mx-auto mt-8" />;
  }
  if (profile.isError) {
    return <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">{t("common.errorLoading", lang)}</p></div>;
  }

  const data = profile.data as any;

  return (
    // Master profile is a single big card; wrap in the settings grid so the
    // layout stays consistent with sibling sections (header row + main card
    // both span 2 cols on md+).
    <div className="grid gap-4 md:grid-cols-2 items-start">
      <div className="md:col-span-2 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t("master.profile", lang)}</h2>
        {!bioEdit ? (
          <button onClick={() => setBioEdit(true)}
            className="flex items-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700">
            <Pencil className="h-3.5 w-3.5" />{t("common.edit", lang)}
          </button>
        ) : (
          <button onClick={() => setBioEdit(false)}
            className="flex items-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
            <X className="h-3.5 w-3.5" />{t("common.cancel", lang)}
          </button>
        )}
      </div>

      <div className="glass-card rounded-2xl p-5 space-y-4 md:col-span-2">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-2xl overflow-hidden bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center text-2xl font-bold text-white shrink-0">
            {data?.photo
              ? <img src={data.photo} alt="" className="h-full w-full object-cover" />
              : (data?.name ?? "M").charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-xl font-bold text-slate-900 dark:text-white">{data?.name ?? t("master.fallbackName", lang)}</p>
            <p className="text-xs text-slate-500">ID: {data?.chatId}</p>
            {data?.bio && !bioEdit && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{data.bio}</p>
            )}
          </div>
        </div>

        {bioEdit && (
          <div className="space-y-3 border-t border-slate-200 dark:border-white/5 pt-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("master.bioLabel", lang)}</label>
              <textarea value={bio} onChange={(e) => setBio(e.target.value)}
                rows={3} maxLength={500} placeholder={t("master.bioPlaceholder", lang)}
                className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500 resize-none" />
              <p className="text-right text-[10px] text-slate-600">{bio.length}/500</p>
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-2 block">{t("master.portfolioLabel", lang)} ({portfolio.length})</label>
              {portfolio.length > 0 && (
                <div className="space-y-2 mb-2">
                  {portfolio.map((url, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <img src={url} alt="" className="h-10 w-10 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0" />
                      <span className="flex-1 text-xs text-slate-500 truncate">{url}</span>
                      <div className="flex gap-1 shrink-0">
                        <button type="button" disabled={i === 0}
                          onClick={() => setPortfolio((prev) => { const a = [...prev]; const tmp = a[i-1]!; a[i-1] = a[i]!; a[i] = tmp; return a; })}
                          className="h-6 w-6 flex items-center justify-center rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30">↑</button>
                        <button type="button" disabled={i === portfolio.length - 1}
                          onClick={() => setPortfolio((prev) => { const a = [...prev]; const tmp = a[i+1]!; a[i+1] = a[i]!; a[i] = tmp; return a; })}
                          className="h-6 w-6 flex items-center justify-center rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30">↓</button>
                        <button type="button"
                          onClick={() => setPortfolio((prev) => prev.filter((_, j) => j !== i))}
                          className="h-6 w-6 flex items-center justify-center rounded bg-red-500/10 text-red-400">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input value={newPortfolioUrl} onChange={(e) => setNewPortfolioUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const u = newPortfolioUrl.trim(); if (u) { setPortfolio((p) => [...p, u]); setNewPortfolioUrl(""); } } }}
                  placeholder="https://example.com/work.jpg"
                  className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500" />
                <button type="button"
                  onClick={() => { const u = newPortfolioUrl.trim(); if (u) { setPortfolio((p) => [...p, u]); setNewPortfolioUrl(""); } }}
                  className="shrink-0 rounded-lg bg-slate-200 dark:bg-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 flex items-center gap-1">
                  <Plus className="h-3.5 w-3.5" />{t("common.add", lang)}
                </button>
              </div>
            </div>
            <button
              onClick={() => updateProfile.mutate({ tenantId, masterId, bio: bio || undefined, portfolio })}
              disabled={updateProfile.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500/20 border border-brand-500/30 px-4 py-2.5 text-sm font-medium text-brand-400 hover:bg-brand-500/30 transition disabled:opacity-50">
              {updateProfile.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t("master.saveProfile", lang)}
            </button>
          </div>
        )}
        {!bioEdit && data?.portfolio?.length > 0 && (
          <div className="border-t border-slate-200 dark:border-white/5 pt-3">
            <p className="text-xs text-slate-500 mb-2">{t("master.portfolioLabel", lang)} ({data.portfolio.length})</p>
            <div className="flex flex-wrap gap-2">
              {data.portfolio.map((url: string, i: number) => (
                <img key={i} src={url} alt="" className="h-16 w-16 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
