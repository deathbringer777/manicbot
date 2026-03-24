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

interface Props {
  data?: { date: string; appointments: number }[];
}

export function OverviewChart({ data = [] }: Props) {
  const chartData =
    data.length > 0
      ? data.map((d) => ({
          name: new Date(d.date).toLocaleDateString("ru-RU", {
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
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis
          dataKey="name"
          stroke="#475569"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          stroke="#475569"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
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
          formatter={(value) => [value ?? 0, "Записи"]}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#3b82f6"
          strokeWidth={2}
          fillOpacity={1}
          fill="url(#colorAppts)"
          dot={false}
          activeDot={{ r: 4, fill: "#3b82f6", strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
