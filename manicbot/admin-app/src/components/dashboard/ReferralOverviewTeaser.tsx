"use client";

/**
 * Compact one-line referral teaser for the Overview tab.
 *
 * Renders ONLY when there's actionable signal: at least one pending
 * referral (= someone redeemed your code but hasn't paid yet) OR an
 * unclaimed reward. Stays silent otherwise to honour the 2026-05-16
 * Overview cleanup ("focused two-card surface, no secondary wizard").
 *
 * Eligibility — server returns FORBIDDEN for staff/non-personal masters;
 * the component renders nothing on error.
 */

import Link from "next/link";
import { Gift, ArrowRight } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";

const COPY = {
  ru: {
    pending: "{n} друга ждёт оплаты",
    pendingOne: "1 друг ждёт оплаты",
    pendingFew: "{n} друга ждут оплаты",
    pendingMany: "{n} друзей ждут оплаты",
    cta: "Реферальная программа",
    earn: "Заработать ещё",
  },
  ua: {
    pending: "{n} друг чекає оплати",
    pendingOne: "1 друг чекає оплати",
    pendingFew: "{n} друга чекають оплати",
    pendingMany: "{n} друзів чекають оплати",
    cta: "Реферальна програма",
    earn: "Заробити ще",
  },
  en: {
    pending: "{n} friends awaiting payment",
    pendingOne: "1 friend awaiting payment",
    pendingFew: "{n} friends awaiting payment",
    pendingMany: "{n} friends awaiting payment",
    cta: "Refer a friend",
    earn: "Earn more",
  },
  pl: {
    pending: "{n} znajomych oczekuje płatności",
    pendingOne: "1 znajomy oczekuje płatności",
    pendingFew: "{n} znajomych oczekuje płatności",
    pendingMany: "{n} znajomych oczekuje płatności",
    cta: "Poleć znajomemu",
    earn: "Zarób więcej",
  },
} as const;

function pluralizePending(n: number, lang: "ru" | "ua" | "en" | "pl"): string {
  const c = COPY[lang];
  if (n === 1) return c.pendingOne;
  // Slavic plural rules: 2-4 → few, 5+ → many. EN/PL use the generic form.
  if (lang === "ru" || lang === "ua") {
    if (n >= 2 && n <= 4) return c.pendingFew.replace("{n}", String(n));
    return c.pendingMany.replace("{n}", String(n));
  }
  return c.pending.replace("{n}", String(n));
}

export function ReferralOverviewTeaser() {
  const { lang } = useLang();
  const q = api.referrals.getMyDashboard.useQuery(undefined, { retry: false });
  if (q.isError || !q.data) return null;
  const c = COPY[lang];

  const pending = q.data.counters.pending + q.data.counters.firstPaid;
  if (pending === 0) return null;

  return (
    <Link
      href="/settings?section=referrals"
      className="group flex items-center justify-between gap-3 rounded-2xl border border-cyan-200/60 bg-gradient-to-r from-cyan-50 to-emerald-50 px-4 py-3 transition hover:from-cyan-100/80 hover:to-emerald-100/80 dark:border-cyan-400/20 dark:from-cyan-500/10 dark:to-emerald-500/10 dark:hover:from-cyan-500/15 dark:hover:to-emerald-500/15"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-700 dark:text-cyan-300">
          <Gift className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
            {pluralizePending(pending, lang)}
          </p>
          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{c.cta}</p>
        </div>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-700 dark:text-slate-500 dark:group-hover:text-slate-200" />
    </Link>
  );
}
