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

const COLORS: Record<string, string> = {
  google: "#4285F4",
  instagram: "#E4405F",
  telegram: "#26A5E4",
  friends: "#a78bfa",
  other: "#64748b",
  unspecified: "#334155",
};

const LABELS_RU: Record<string, string> = {
  google: "Google",
  instagram: "Instagram",
  telegram: "Telegram",
  friends: "Друзья / знакомые",
  other: "Другое",
  unspecified: "Не указано",
};

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
  const barData = [...bySource]
    .sort((a, b) => b.count - a.count)
    .map((r) => ({
      key: r.source,
      name: LABELS_RU[r.source] ?? r.source,
      value: r.count,
      fill: COLORS[r.source] ?? COLORS.other,
    }));

  const dailyChart = daily.map((d) => ({
    ...d,
    label: new Date(d.date + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" }),
  }));

  const hasDaily = dailyChart.some((d) =>
    STACK_KEYS.some((k) => d[k] > 0),
  );

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="glass-card rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-white">Регистрации web: откуда узнали</h2>
          {totalLabel && <span className="text-[10px] text-slate-500 tabular-nums">{totalLabel}</span>}
        </div>
        {barData.length === 0 ? (
          <p className="text-xs text-slate-500 py-8 text-center">Нет данных за выбранный период</p>
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
                formatter={(value) => [value ?? 0, "Регистрации"]}
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
        <h2 className="text-sm font-bold text-white mb-3">По дням (стек)</h2>
        {!hasDaily ? (
          <p className="text-xs text-slate-500 py-8 text-center">Нет регистраций по дням</p>
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
                <Bar key={k} stackId="signup" dataKey={k} name={LABELS_RU[k]} fill={COLORS[k]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
