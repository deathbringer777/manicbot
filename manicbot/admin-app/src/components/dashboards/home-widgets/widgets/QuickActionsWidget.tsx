"use client";

/**
 * quick_actions widget — shortcut buttons that fire the host's EXISTING
 * dashboard actions (open the manual-booking modal, the create-client modal,
 * jump to the services tab, open the appointments calendar). The handlers come
 * from `HomeWidgetContext` so this widget reuses the same flows the rest of the
 * dashboard already triggers — it invents no new navigation.
 *
 * When the host context is absent (board rendered outside a salon, e.g. tests)
 * the buttons render disabled rather than throwing.
 */

import { CalendarPlus, UserPlus, Scissors, CalendarDays } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "~/components/ui/Card";
import { t, type TranslationKey } from "~/lib/i18n";
import { useHomeWidgetHost } from "../HomeWidgetContext";
import type { WidgetRenderProps } from "../registry";

export function QuickActionsWidget({ lang }: WidgetRenderProps) {
  const host = useHomeWidgetHost();

  const actions: { key: TranslationKey; icon: LucideIcon; onClick?: () => void }[] = [
    { key: "widget.quickActions.newBooking", icon: CalendarPlus, onClick: host?.onNewBooking },
    { key: "widget.quickActions.addClient", icon: UserPlus, onClick: host?.onAddClient },
    { key: "widget.quickActions.addService", icon: Scissors, onClick: host?.onAddService },
    { key: "widget.quickActions.openCalendar", icon: CalendarDays, onClick: host?.onOpenCalendar },
  ];

  return (
    <Card padding="p-4" className="h-full overflow-y-auto">
      <div className="space-y-1.5">
        {actions.map(({ key, icon: Icon, onClick }) => (
          <button
            key={key}
            type="button"
            disabled={!onClick}
            onClick={onClick}
            className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium text-[#374151] transition-colors hover:bg-[#f3f4f6] hover:text-[#1a1a2e] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:text-slate-300 dark:hover:bg-white/[0.04] dark:hover:text-white"
          >
            <Icon className="h-4 w-4 shrink-0 text-[#9ca3af] transition-colors group-hover:text-accent-600 dark:text-slate-500 dark:group-hover:text-accent-400" />
            <span className="flex-1">{t(key, lang)}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
