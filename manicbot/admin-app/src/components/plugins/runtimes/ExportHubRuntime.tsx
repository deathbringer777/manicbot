"use client";

/**
 * Export Hub plugin runtime — quick CSV downloads scoped to viewer's role.
 */

import { useState } from "react";
import { Download, FileText, Users, CalendarDays, Receipt } from "lucide-react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { toast } from "~/lib/toast";
import type { PluginRuntimeProps } from "../runtimePanels";

const LABELS = {
  title: { ru: "Экспорт", ua: "Експорт", en: "Export", pl: "Eksport" },
  subtitle: {
    ru: "CSV-файлы с данными в рамках ваших прав.",
    ua: "CSV-файли з даними у межах ваших прав.",
    en: "CSV files scoped to your permissions.",
    pl: "Pliki CSV w zakresie Twoich uprawnień.",
  },
  ready: { ru: "Готово", ua: "Готово", en: "Ready", pl: "Gotowe" },
  noData: { ru: "Нет данных", ua: "Немає даних", en: "No data", pl: "Brak danych" },
} as const;

interface ExportCard {
  id: string;
  title: Record<string, string>;
  description: Record<string, string>;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  role: "any" | "admin" | "tenant";
  build: () => Promise<string[][]> | string[][];
  filename: string;
}

function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => {
    const s = String(c ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }).join(",")).join("\n");
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function ExportHubRuntime({ installationId }: PluginRuntimeProps) {
  const { role } = useRole();
  const { lang } = useLang();
  const [busy, setBusy] = useState<string | null>(null);

  const CARDS: ExportCard[] = [
    {
      id: "pinned-plugins",
      title: { ru: "Закреплённые плагины", ua: "Закріплені плагіни", en: "Pinned plugins", pl: "Przypięte wtyczki" },
      description: { ru: "Ваш список pinned из localStorage.", ua: "Ваш список pinned із localStorage.", en: "Your pinned list from localStorage.", pl: "Twoja lista przypiętych z localStorage." },
      icon: FileText,
      role: "any",
      filename: "pinned-plugins.csv",
      build: () => {
        const raw = localStorage.getItem("manicbot_pinned_plugins");
        const list = raw ? (JSON.parse(raw) as string[]) : [];
        return [["slug"], ...list.map((s) => [s])];
      },
    },
    {
      id: "task-board",
      title: { ru: "Доска задач", ua: "Дошка задач", en: "Task Board", pl: "Tablica zadań" },
      description: { ru: "Задачи из Task Board plugin.", ua: "Задачі з Task Board plugin.", en: "Tasks from the Task Board plugin.", pl: "Zadania z wtyczki Task Board." },
      icon: CalendarDays,
      role: "any",
      filename: "task-board.csv",
      build: () => {
        const rows: string[][] = [["id", "column", "title", "created_at"]];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key || !key.startsWith("manicbot_plugin_task_board_")) continue;
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          try {
            const tasks = JSON.parse(raw) as { id: string; column: string; title: string; createdAt: number }[];
            for (const t of tasks) rows.push([t.id, t.column, t.title, new Date(t.createdAt).toISOString()]);
          } catch { /* noop */ }
        }
        return rows;
      },
    },
    {
      id: "settings",
      title: { ru: "Настройки интерфейса", ua: "Налаштування інтерфейсу", en: "UI settings", pl: "Ustawienia interfejsu" },
      description: { ru: "Тема, свёрнутые группы, закреплённое.", ua: "Тема, згорнуті групи, закріплене.", en: "Theme, collapsed groups, pinned items.", pl: "Motyw, zwinięte grupy, przypięte." },
      icon: Receipt,
      role: "any",
      filename: "ui-settings.csv",
      build: () => {
        const rows: string[][] = [["key", "value"]];
        const keys = ["manicbot_web_theme", "manicbot_lang", "manicbot_pinned_plugins", "manicbot_nav_collapsed_groups"];
        for (const k of keys) {
          const v = localStorage.getItem(k);
          if (v !== null) rows.push([k, v]);
        }
        return rows;
      },
    },
  ];

  const visible = CARDS.filter((c) => c.role === "any" || (c.role === "admin" && role === "system_admin"));

  return (
    <div data-testid="export-hub-runtime" data-installation-id={installationId} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {visible.map((card) => {
        const Icon = card.icon;
        return (
          <button
            key={card.id}
            type="button"
            data-testid={`export-${card.id}`}
            disabled={busy === card.id}
            onClick={async () => {
              setBusy(card.id);
              try {
                const rows = await card.build();
                if (rows.length <= 1) {
                  toast.info(LABELS.noData[lang]);
                  return;
                }
                download(card.filename, toCsv(rows));
                toast.success(LABELS.ready[lang], `${rows.length - 1} rows`);
              } catch (e) {
                toast.error(String(e));
              } finally {
                setBusy(null);
              }
            }}
            className="text-left rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/40 p-4 hover:border-brand-500/50 dark:hover:border-brand-400/40 transition-colors disabled:opacity-50"
          >
            <div className="flex items-center justify-between gap-3 mb-2">
              <Icon size={18} className="text-brand-500" />
              <Download size={13} className="text-slate-400" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {card.title[lang] ?? card.title.ru}
            </h3>
            <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
              {card.description[lang] ?? card.description.ru}
            </p>
          </button>
        );
      })}
    </div>
  );
}

// also export the `role` param for consistency
export type { PluginRuntimeProps };
