"use client";

import Link from "next/link";
import { Activity, ArrowUpRight, Info } from "lucide-react";
import { useLang } from "~/components/LangContext";
import type { PluginRuntimeProps } from "../runtimePanels";

const LABELS = {
  title: {
    ru: "Плагин работает в фоне",
    ua: "Плагін працює у фоні",
    en: "This plugin runs in the background",
    pl: "Wtyczka działa w tle",
  },
  body: {
    ru: "У этого плагина нет интерактивной панели — он подключается к событиям платформы, триггерам и метрикам автоматически. Результаты смотрите в указанных разделах.",
    ua: "Цей плагін не має інтерактивної панелі — він підключається до подій платформи, тригерів і метрик автоматично. Результати дивіться у вказаних розділах.",
    en: "This plugin has no interactive panel — it hooks into platform events, triggers, and metrics automatically. Outputs appear in the linked dashboards.",
    pl: "Ta wtyczka nie ma interaktywnego panelu — łączy się z wydarzeniami platformy, triggerami i metrykami automatycznie. Wyniki w wymienionych dashboardach.",
  },
  events: {
    ru: "Лог событий",
    ua: "Лог подій",
    en: "Event log",
    pl: "Dziennik zdarzeń",
  },
  system: { ru: "Система", ua: "Система", en: "System", pl: "System" },
} as const;

export default function BackgroundRuntimePlaceholder({ slug }: PluginRuntimeProps) {
  const { lang } = useLang();
  return (
    <div
      data-testid="background-runtime-placeholder"
      data-slug={slug}
      className="rounded-xl border border-dashed border-slate-300 dark:border-white/10 bg-slate-50/60 dark:bg-slate-900/30 p-6 flex items-start gap-3"
    >
      <Info size={18} className="text-brand-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {LABELS.title[lang]}
        </h3>
        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
          {LABELS.body[lang]}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/events"
            className="inline-flex items-center gap-1 text-[12px] text-brand-600 dark:text-brand-400 hover:underline"
          >
            <Activity size={11} /> {LABELS.events[lang]} <ArrowUpRight size={11} />
          </Link>
          <Link
            href="/system"
            className="inline-flex items-center gap-1 text-[12px] text-slate-600 dark:text-slate-300 hover:underline"
          >
            {LABELS.system[lang]} <ArrowUpRight size={11} />
          </Link>
        </div>
      </div>
    </div>
  );
}
