"use client";

import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import { TrendingUp, Target, Users, Loader2, Link2, ChevronDown, ChevronUp, BarChart3, Route } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";
import { SectionHeader } from "~/components/salon/SalonShared";
import { TrackingLinksGenerator } from "~/components/salon/TrackingLinksGenerator";

const SOURCE_COLORS: Record<string, string> = {
  qr: "#EC4899",
  website: "#3B82F6",
  instagram: "#E1306C",
  tiktok: "#000000",
  facebook: "#1877F2",
  google_maps: "#34A853",
  flyer: "#F59E0B",
  sms: "#8B5CF6",
  telegram: "#229ED9",
  direct: "#64748B",
  other: "#94A3B8",
};

function colorFor(source: string): string {
  return SOURCE_COLORS[source] ?? "#94A3B8";
}

function labelFor(source: string, lang: Lang): string {
  switch (source) {
    case "qr": return t("analytics.source.qr", lang);
    case "website": return t("analytics.source.website", lang);
    case "flyer": return t("analytics.source.flyer", lang);
    case "direct": return t("analytics.source.direct", lang);
    case "other": return t("analytics.source.other", lang);
    case "instagram": return "Instagram";
    case "tiktok": return "TikTok";
    case "facebook": return "Facebook";
    case "google_maps": return "Google Maps";
    case "sms": return "SMS";
    case "telegram": return "Telegram";
    default: return source;
  }
}

function StatBox({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ElementType;
}) {
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-brand-500/15 flex items-center justify-center text-brand-500">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{value}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
          {hint && <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>}
        </div>
      </div>
    </div>
  );
}

function FunnelCard({
  stages,
}: {
  stages: { key: string; label: string; count: number }[];
}) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div data-testid="funnel-card" className="glass-card rounded-2xl p-4 space-y-2">
      {stages.map((s, i) => {
        const pct = max > 0 ? Math.max(4, Math.round((s.count / max) * 100)) : 0;
        const prev = i > 0 ? stages[i - 1]! : null;
        const dropoff = prev && prev.count > 0
          ? Math.round(((prev.count - s.count) / prev.count) * 100)
          : 0;
        return (
          <div key={s.key} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-700 dark:text-slate-300 font-medium">{s.label}</span>
              <span className="text-slate-900 dark:text-white tabular-nums font-semibold">
                {s.count}
                {i > 0 && dropoff > 0 && (
                  <span className="ml-2 text-[10px] text-slate-500">−{dropoff}%</span>
                )}
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AnalyticsEmptyState({ onCreateLink }: { onCreateLink: () => void }) {
  const { lang } = useLang();
  return (
    <div className="glass-card rounded-2xl p-8 flex flex-col items-center text-center space-y-4">
      <div className="h-14 w-14 rounded-2xl bg-brand-500/10 flex items-center justify-center">
        <BarChart3 className="h-7 w-7 text-brand-400" />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">{t("analytics.empty.title", lang)}</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md">
          {t("analytics.empty.text", lang)}
        </p>
      </div>
      <button
        type="button"
        onClick={onCreateLink}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-500/15 text-brand-400 text-sm font-medium hover:bg-brand-500/25 transition-colors"
      >
        <Link2 className="h-4 w-4" />
        {t("analytics.createLink", lang)}
      </button>
    </div>
  );
}

function FunnelEmptyState({ onCreateLink }: { onCreateLink: () => void }) {
  const { lang } = useLang();
  return (
    <div data-testid="funnel-empty" className="glass-card rounded-2xl p-6 flex flex-col items-center text-center space-y-3">
      <div className="h-12 w-12 rounded-2xl bg-brand-500/10 flex items-center justify-center">
        <Route className="h-6 w-6 text-brand-400" />
      </div>
      <div className="space-y-1 max-w-md">
        <h4 className="text-sm font-bold text-slate-900 dark:text-white">
          {t("analytics.funnel.empty.title", lang)}
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          {t("analytics.funnel.empty.text", lang)}
        </p>
      </div>
      <button
        type="button"
        onClick={onCreateLink}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand-500/15 text-brand-400 text-xs font-medium hover:bg-brand-500/25 transition-colors"
      >
        <Link2 className="h-3.5 w-3.5" />
        {t("analytics.createLink", lang)}
      </button>
    </div>
  );
}

export function AnalyticsTab({
  tenantId,
  botUsername,
  slug,
}: {
  tenantId: string;
  botUsername?: string | null;
  slug?: string | null;
}) {
  const { lang } = useLang();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [showLinkGen, setShowLinkGen] = useState(false);

  const acquisition = api.analytics.getAcquisition.useQuery({ tenantId, days });
  const funnel = api.analytics.getFunnel.useQuery({ tenantId, days });
  const topCampaigns = api.analytics.getTopCampaigns.useQuery({ tenantId, days });

  const isLoading = acquisition.isLoading || funnel.isLoading || topCampaigns.isLoading;

  const totalUsers = acquisition.data?.totalUsers ?? 0;
  const totalBookings = funnel.data?.stages.find((s) => s.key === "booked")?.count ?? 0;
  const totalTouches = funnel.data?.stages[0]?.count ?? 0;
  const hasAnyData = totalUsers > 0 || totalBookings > 0 || totalTouches > 0;
  const hasTrackedTouches = totalTouches > 0;

  function openLinkGenerator() {
    setShowLinkGen(true);
    if (typeof window !== "undefined") {
      requestAnimationFrame(() => {
        document.getElementById("tracking-links-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <SectionHeader title={t("analytics.title", lang)} />
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d as 7 | 30 | 90)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                days === d
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {d}{t("analytics.daysShort", lang)}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}

      {!isLoading && !hasAnyData && (
        <AnalyticsEmptyState onCreateLink={openLinkGenerator} />
      )}

      {!isLoading && hasAnyData && (
        <>
          {/* ── Stat cards ─────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3">
            <StatBox
              label={t("analytics.newClients", lang)}
              value={totalUsers}
              hint={`${t("analytics.lastNDays", lang)} ${days} ${t("analytics.daysWord", lang)}`}
              icon={Users}
            />
            <StatBox
              label={t("analytics.bookings", lang)}
              value={totalBookings}
              hint={t("analytics.uniqueHint", lang)}
              icon={Target}
            />
            <div data-testid="conversion-stat" data-tracked={hasTrackedTouches ? "1" : "0"}>
              <StatBox
                label={t("analytics.conversion", lang)}
                value={
                  hasTrackedTouches && funnel.data && (funnel.data.stages[1]?.count ?? 0) > 0
                    ? `${Math.round((totalBookings / (funnel.data.stages[1]!.count ?? 1)) * 100)}%`
                    : "—"
                }
                hint={
                  hasTrackedTouches
                    ? t("analytics.touchToBookHint", lang)
                    : t("analytics.noTrackedTouches", lang)
                }
                icon={TrendingUp}
              />
            </div>
          </div>

          {/* ── Acquisition chart ──────────────────────────────── */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">
              {t("analytics.trafficSources", lang)}
            </h3>
            {acquisition.data && acquisition.data.sources.length > 0 ? (
              <div className="glass-card rounded-2xl p-4">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={acquisition.data.daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v: string) => v.slice(5)}
                      stroke="currentColor"
                      className="text-slate-500"
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      allowDecimals={false}
                      stroke="currentColor"
                      className="text-slate-500"
                    />
                    <Tooltip
                      contentStyle={{
                        background: "rgb(15 23 42)",
                        border: "1px solid rgb(51 65 85)",
                        borderRadius: 8,
                        fontSize: 11,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {acquisition.data.sources.map((src) => (
                      <Bar key={src} dataKey={src} stackId="a" fill={colorFor(src)} name={labelFor(src, lang)} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="glass-card rounded-2xl p-8 text-center text-sm text-slate-500">
                {t("analytics.noDataPeriod", lang)}
              </div>
            )}
          </div>

          {/* ── Funnel ─────────────────────────────────────────── */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">
              {t("analytics.funnel", lang)}
            </h3>
            {hasTrackedTouches && funnel.data ? (
              <FunnelCard stages={funnel.data.stages} />
            ) : (
              <FunnelEmptyState onCreateLink={openLinkGenerator} />
            )}
          </div>

          {/* ── Top campaigns ──────────────────────────────────── */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">
              {t("analytics.topCampaigns", lang)}
            </h3>
            {topCampaigns.data && topCampaigns.data.campaigns.length > 0 ? (
              <div className="glass-card rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">{t("analytics.colSource", lang)}</th>
                      <th className="text-left px-3 py-2 font-medium">{t("analytics.colCampaign", lang)}</th>
                      <th className="text-right px-3 py-2 font-medium">{t("analytics.colClients", lang)}</th>
                      <th className="text-right px-3 py-2 font-medium">{t("analytics.colBookings", lang)}</th>
                      <th className="text-right px-3 py-2 font-medium">{t("analytics.colConv", lang)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCampaigns.data.campaigns.map((c, i) => (
                      <tr key={`${c.source}-${c.campaign}-${i}`} className="border-t border-slate-200 dark:border-white/5">
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ background: colorFor(c.source) }}
                            />
                            {labelFor(c.source, lang)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-500">{c.campaign ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{c.users}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{c.bookings}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-brand-500 font-semibold">
                          {c.conversion}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            ) : (
              <div className="glass-card rounded-2xl p-6 text-center text-sm text-slate-500">
                {t("analytics.noCampaigns", lang)}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Tracking links (collapsible) ───────────────────── */}
      <div id="tracking-links-section">
        <button
          type="button"
          onClick={() => setShowLinkGen((v) => !v)}
          className="flex items-center gap-2 w-full glass-card rounded-2xl px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
        >
          <Link2 className="h-4 w-4 text-brand-400" />
          <span className="flex-1 text-left">{t("analytics.createLink", lang)}</span>
          {showLinkGen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </button>
        {showLinkGen && (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed px-1">
              {t("tracking.intro", lang)}
            </p>
            <TrackingLinksGenerator
              tenantId={tenantId}
              botUsername={botUsername}
              slug={slug}
            />
          </div>
        )}
      </div>
    </div>
  );
}
