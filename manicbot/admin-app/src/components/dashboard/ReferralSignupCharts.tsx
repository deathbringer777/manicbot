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
import { SOURCE_COLORS, sourceColor } from "~/lib/theme/palette";

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
      fill: sourceColor(r.source),
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
          <h2 className="text-sm font-bold text-foreground">{t("charts.signupsTitle", lang)}</h2>
          {totalLabel && <span className="text-[10px] text-slate-500 tabular-nums">{totalLabel}</span>}
        </div>
        {barData.length === 0 ? (
          <p className="text-xs text-slate-500 py-8 text-center">{t("charts.noPeriodData", lang)}</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={barData} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
              <XAxis type="number" stroke="var(--chart-axis)" fontSize={11} tickLine={false} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                stroke="var(--chart-axis)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={120}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--chart-tooltip-bg)",
                  border: "1px solid var(--chart-grid)",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                itemStyle={{ color: "var(--chart-tooltip-text)" }}
                labelStyle={{ color: "var(--chart-axis-text)" }}
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
        <h2 className="text-sm font-bold text-foreground mb-3">{t("charts.byDayStack", lang)}</h2>
        {!hasDaily ? (
          <p className="text-xs text-slate-500 py-8 text-center">{t("charts.noDailySignups", lang)}</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dailyChart} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="label" stroke="var(--chart-axis)" fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis stroke="var(--chart-axis)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--chart-tooltip-bg)",
                  border: "1px solid var(--chart-grid)",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Legend wrapperStyle={{ fontSize: "10px" }} />
              {STACK_KEYS.map((k) => (
                <Bar key={k} stackId="signup" dataKey={k} name={labelFor(k, lang)} fill={SOURCE_COLORS[k]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
