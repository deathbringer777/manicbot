"use client";

/**
 * SalonAgendaView — text-list view of upcoming and past appointments.
 *
 * Counterpart to SalonBigCalendar (month grid). Designed for at-a-glance
 * "what's coming up" use cases (vs. spatial calendar layout).
 *
 * Reuses AptCard for status pills, action buttons, and no-show flow so
 * styling stays consistent across calendar/list/agenda modes.
 */

import { useMemo } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import { AptCard } from "~/components/dashboard-ui/AptCard";
import { EmptyState } from "~/components/ui/EmptyState";
import { t, type Lang } from "~/lib/i18n";

/**
 * Loose row type — the Drizzle schema row shape is wider (43+ fields) and
 * uses `integer` for booleans. AptCard already accepts `any`, so we keep
 * agenda's input loose and only project the columns we actually read.
 */
type AgendaApt = Record<string, any> & {
  id: number | string;
  date: string;
  time: string;
};

interface Props {
  apts: AgendaApt[];
  isLoading: boolean;
  lang: Lang;
  onAction: (id: number | string, status: "confirmed" | "cancelled" | "rejected") => void;
  onNoShow: (id: number | string, noShowBy: "client" | "master") => void;
}

interface DayGroup {
  iso: string;
  apts: AgendaApt[];
}

function groupByDay(apts: AgendaApt[]): DayGroup[] {
  const map = new Map<string, AgendaApt[]>();
  for (const a of apts) {
    if (!map.has(a.date)) map.set(a.date, []);
    map.get(a.date)!.push(a);
  }
  const groups: DayGroup[] = [];
  for (const [iso, list] of map) {
    list.sort((x, y) => (x.time ?? "").localeCompare(y.time ?? ""));
    groups.push({ iso, apts: list });
  }
  groups.sort((a, b) => a.iso.localeCompare(b.iso));
  return groups;
}

function formatDayLabel(iso: string, lang: Lang): string {
  const locale =
    lang === "ua" ? "uk-UA" : lang === "pl" ? "pl-PL" : lang === "en" ? "en-US" : "ru-RU";
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);
  if (iso === todayIso) return t("salon.cal.today", lang);
  if (iso === tomorrowIso) return locale.startsWith("ru") ? "Завтра" : locale.startsWith("uk") ? "Завтра" : locale.startsWith("pl") ? "Jutro" : "Tomorrow";
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
}

export function SalonAgendaView({ apts, isLoading, lang, onAction, onNoShow }: Props) {
  const todayIso = new Date().toISOString().slice(0, 10);

  const { upcoming, past } = useMemo(() => {
    const u: AgendaApt[] = [];
    const p: AgendaApt[] = [];
    for (const a of apts) {
      if (a.date >= todayIso) u.push(a);
      else p.push(a);
    }
    return { upcoming: groupByDay(u), past: groupByDay(p).reverse() };
  }, [apts, todayIso]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-8" data-testid="agenda-loading">
        <Loader2 className="animate-spin text-brand-400" />
      </div>
    );
  }

  if (upcoming.length === 0 && past.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title={t("salon.cal.noUpcoming", lang)}
        description={t("salon.empty.apts", lang)}
      />
    );
  }

  return (
    <div className="space-y-6" data-testid="agenda-view">
      {upcoming.length > 0 && (
        <section data-testid="agenda-upcoming">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-2 px-1">
            {t("salon.cal.upcoming", lang)}
          </h3>
          <div className="space-y-4">
            {upcoming.map((g) => (
              <div key={g.iso} className="space-y-2" data-day={g.iso}>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white capitalize">
                  {formatDayLabel(g.iso, lang)}
                </h4>
                <div className="space-y-2">
                  {g.apts.map((a) => (
                    <AptCard key={a.id} a={a} lang={lang} onAction={onAction} onNoShow={onNoShow} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section data-testid="agenda-past">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-2 px-1">
            {t("salon.cal.past", lang)}
          </h3>
          <div className="space-y-4">
            {past.map((g) => (
              <div key={g.iso} className="space-y-2 opacity-70" data-day={g.iso}>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white capitalize">
                  {formatDayLabel(g.iso, lang)}
                </h4>
                <div className="space-y-2">
                  {g.apts.map((a) => (
                    <AptCard key={a.id} a={a} lang={lang} onAction={onAction} onNoShow={onNoShow} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
