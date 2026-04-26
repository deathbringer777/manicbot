"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";

const COLORS: Record<string, string> = {
  google: "#4285F4",
  instagram: "#E4405F",
  telegram: "#26A5E4",
  friends: "#a78bfa",
  other: "#64748b",
  unspecified: "#334155",
};

function labelFor(source: string, lang: Lang): string {
  switch (source) {
    case "google": return "Google";
    case "instagram": return "Instagram";
    case "telegram": return "Telegram";
    case "friends": return t("referral.friends", lang);
    case "other": return t("referral.other", lang);
    case "unspecified": return t("referral.unspecified", lang);
    default: return source;
  }
}

const STACK_KEYS = ["google", "instagram", "telegram", "friends", "other", "unspecified"] as const;

export type ReferralSignupChartsProps = {
  bySource: { source: string; count: number }[];
  daily: {
    date: string;
    google: number;
    instagram: number;
    telegram: number;
    friends: number;
    other: number;
    unspecified: number;
  }[];
  totalLabel?: string;
};

export function ReferralSignupCharts({ bySource, daily, totalLabel }: ReferralSignupChartsProps) {
  const { lang } = useLang();
  const dateLocale = lang === "pl" ? "pl-PL" : lang === "en" ? "en-US" : lang === "ua" ? "uk-UA" : "ru-RU";
  const barData = [...bySource]
    .sort((a, b) => b.count - a.count)
    .map((r) => ({
      key: r.source,
      name: labelFor(r.source, lang),
      value: r.count,
      fill: COLORS[r.source] ?? COLORS.other,
    }));

  const dailyChart = daily.map((d) => ({
    ...d,
    label: new Date(d.date + "T12:00:00").toLocaleDateString(dateLocale, { day: "numeric", month: "short" }),
  }));

  const hasDaily = dailyChart.some((d) =>
    STACK_KEYS.some((k) => d[k] > 0),
  );

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="glass-card rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-white">{t("charts.signupsTitle", lang)}</h2>
          {totalLabel && <span className="text-[10px] text-slate-500 tabular-nums">{totalLabel}</span>}
        </div>
        {barData.length === 0 ? (
          <p className="text-xs text-slate-500 py-8 text-center">{t("charts.noPeriodData", lang)}</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={barData} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
              <XAxis type="number" stroke="#475569" fontSize={11} tickLine={false} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                stroke="#475569"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={120}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0f172a",
                  border: "1px solid #1e293b",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                itemStyle={{ color: "#f8fafc" }}
                labelStyle={{ color: "#94a3b8" }}
                formatter={(value) => [value ?? 0, t("charts.tooltipSignups", lang)]}
              />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={28}>
                {barData.map((e) => (
                  <Cell key={e.key} fill={e.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="glass-card rounded-2xl p-4">
        <h2 className="text-sm font-bold text-white mb-3">{t("charts.byDayStack", lang)}</h2>
        {!hasDaily ? (
          <p className="text-xs text-slate-500 py-8 text-center">{t("charts.noDailySignups", lang)}</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dailyChart} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="label" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis stroke="#475569" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0f172a",
                  border: "1px solid #1e293b",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Legend wrapperStyle={{ fontSize: "10px" }} />
              {STACK_KEYS.map((k) => (
                <Bar key={k} stackId="signup" dataKey={k} name={labelFor(k, lang)} fill={COLORS[k]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
