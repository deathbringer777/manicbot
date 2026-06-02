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
import { t, localeFor } from "~/lib/i18n";

interface Props {
  /** Daily buckets from billing.getLedgerSummary — money in Stripe minor units. */
  data?: { date: string; gross: number; net: number; fee: number }[];
}

/**
 * Daily net-revenue area chart for the God Mode Billing dashboard, sourced from
 * the `stripe_ledger` mirror (not a live Stripe call). Plots net in whole PLN;
 * the tooltip formats the localized currency.
 */
export function RevenueChart({ data = [] }: Props) {
  const { lang } = useLang();
  const locale = localeFor(lang);
  const fmt = new Intl.NumberFormat(locale, { style: "currency", currency: "PLN", maximumFractionDigits: 0 });

  const chartData =
    data.length > 0
      ? data.map((d) => ({
          name: new Date(d.date).toLocaleDateString(locale, { day: "numeric", month: "short" }),
          net: d.net / 100,
        }))
      : [
          { name: "—", net: 0 },
          { name: "—", net: 0 },
        ];

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="colorNet" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
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
          width={52}
          tickFormatter={(v) => fmt.format(Number(v))}
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
          formatter={(value) => [fmt.format(Number(value)), t("gmBilling.netRevenue", lang)]}
        />
        <Area
          type="monotone"
          dataKey="net"
          stroke="#10b981"
          strokeWidth={2}
          fillOpacity={1}
          fill="url(#colorNet)"
          dot={false}
          activeDot={{ r: 4, fill: "#10b981", strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
