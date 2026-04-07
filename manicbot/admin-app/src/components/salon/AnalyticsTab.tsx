"use client";

import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import { TrendingUp, Target, Users, Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
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
    <div className="glass-card rounded-2xl p-4 space-y-2">
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

export function AnalyticsTab({
  tenantId,
  botUsername,
  slug,
}: {
  tenantId: string;
  botUsername?: string | null;
  slug?: string | null;
}) {
  const [days, setDays] = useState<7 | 30 | 90>(30);

  const acquisition = api.analytics.getAcquisition.useQuery({ tenantId, days });
  const funnel = api.analytics.getFunnel.useQuery({ tenantId, days });
  const topCampaigns = api.analytics.getTopCampaigns.useQuery({ tenantId, days });

  const isLoading = acquisition.isLoading || funnel.isLoading || topCampaigns.isLoading;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <SectionHeader title="Аналитика" />
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
              {d}д
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}

      {!isLoading && (
        <>
          {/* ── Stat cards ─────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3">
            <StatBox
              label="Новых клиентов"
              value={acquisition.data?.totalUsers ?? 0}
              hint={`за ${days} дней`}
              icon={Users}
            />
            <StatBox
              label="Записей"
              value={funnel.data?.stages.find((s) => s.key === "booked")?.count ?? 0}
              hint="уникальных"
              icon={Target}
            />
            <StatBox
              label="Конверсия"
              value={`${
                funnel.data && (funnel.data.stages[1]?.count ?? 0) > 0
                  ? Math.round(
                      ((funnel.data.stages.find((s) => s.key === "booked")?.count ?? 0) /
                        (funnel.data.stages[1]!.count ?? 1)) * 100,
                    )
                  : 0
              }%`}
              hint="касание → бронь"
              icon={TrendingUp}
            />
          </div>

          {/* ── Acquisition chart ──────────────────────────────── */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">
              Источники трафика
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
                      <Bar key={src} dataKey={src} stackId="a" fill={colorFor(src)} name={src} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="glass-card rounded-2xl p-8 text-center text-sm text-slate-500">
                Пока нет данных. Сгенерируйте трекинг-ссылку ниже и поделитесь ею.
              </div>
            )}
          </div>

          {/* ── Funnel ─────────────────────────────────────────── */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">
              Воронка конверсии
            </h3>
            {funnel.data && <FunnelCard stages={funnel.data.stages} />}
          </div>

          {/* ── Top campaigns ──────────────────────────────────── */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">
              Топ кампаний
            </h3>
            {topCampaigns.data && topCampaigns.data.campaigns.length > 0 ? (
              <div className="glass-card rounded-2xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Источник</th>
                      <th className="text-left px-3 py-2 font-medium">Кампания</th>
                      <th className="text-right px-3 py-2 font-medium">Клиенты</th>
                      <th className="text-right px-3 py-2 font-medium">Брони</th>
                      <th className="text-right px-3 py-2 font-medium">Конв.</th>
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
                            {c.source}
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
            ) : (
              <div className="glass-card rounded-2xl p-6 text-center text-sm text-slate-500">
                Нет данных о кампаниях
              </div>
            )}
          </div>

          {/* ── Tracking links generator ───────────────────────── */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">
              Трекинг-ссылки
            </h3>
            <TrackingLinksGenerator
              tenantId={tenantId}
              botUsername={botUsername}
              slug={slug}
            />
          </div>
        </>
      )}
    </div>
  );
}
