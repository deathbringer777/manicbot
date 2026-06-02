"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

interface Props {
  data?: { date: string; appointments: number }[];
}

export function OverviewChart({ data = [] }: Props) {
  const { lang } = useLang();
  const dateLocale = lang === "pl" ? "pl-PL" : lang === "en" ? "en-US" : lang === "ua" ? "uk-UA" : "ru-RU";
  const chartData =
    data.length > 0
      ? data.map((d) => ({
          name: new Date(d.date).toLocaleDateString(dateLocale, {
            day: "numeric",
            month: "short",
          }),
          value: d.appointments,
        }))
      : [
          { name: "—", value: 0 },
          { name: "—", value: 0 },
        ];

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="colorAppts" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-line)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--chart-line)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis
          dataKey="name"
          stroke="var(--chart-axis)"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          stroke="var(--chart-axis)"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
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
          formatter={(value) => [value ?? 0, t("charts.tooltipBookings", lang)]}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--chart-line)"
          strokeWidth={2}
          fillOpacity={1}
          fill="url(#colorAppts)"
          dot={false}
          activeDot={{ r: 4, fill: "var(--chart-line)", strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
