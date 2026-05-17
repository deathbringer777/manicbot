"use client";

/**
 * Task Board plugin runtime — 3-column Kanban backed by localStorage.
 * No server round-trip — good enough for a MVP "it actually works" demo.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, X, Circle, Clock, CheckCircle2 } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { PluginRuntimeShell } from "../PluginRuntimeShell";
import type { PluginRuntimeProps } from "../runtimePanels";

type Column = "todo" | "doing" | "done";
interface Task {
  id: string;
  title: string;
  column: Column;
  createdAt: number;
}

const STORAGE_KEY = (installationId: string) => `manicbot_plugin_task_board_${installationId}`;

function readTasks(installationId: string): Task[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY(installationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as Task[] : [];
  } catch {
    return [];
  }
}

function writeTasks(installationId: string, tasks: Task[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY(installationId), JSON.stringify(tasks));
  } catch { /* noop */ }
}

const COLUMNS: { key: Column; icon: React.ComponentType<{ size?: number; className?: string }>; tint: string }[] = [
  { key: "todo", icon: Circle, tint: "text-slate-400" },
  { key: "doing", icon: Clock, tint: "text-amber-500" },
  { key: "done", icon: CheckCircle2, tint: "text-emerald-500" },
];

const LABELS: Record<Column, Record<string, string>> = {
  todo: { ru: "К выполнению", ua: "До виконання", en: "To do", pl: "Do zrobienia" },
  doing: { ru: "В работе", ua: "В роботі", en: "In progress", pl: "W toku" },
  done: { ru: "Готово", ua: "Готово", en: "Done", pl: "Gotowe" },
};

const PLACEHOLDERS: Record<string, string> = {
  ru: "Новая задача…",
  ua: "Нова задача…",
  en: "New task…",
  pl: "Nowe zadanie…",
};

export default function TaskBoardRuntime({ installationId, slug }: PluginRuntimeProps) {
  const { lang } = useLang();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [drafts, setDrafts] = useState<Record<Column, string>>({
    todo: "",
    doing: "",
    done: "",
  });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<Column | null>(null);

  useEffect(() => {
    setTasks(readTasks(installationId));
  }, [installationId]);

  const add = useCallback((col: Column) => {
    const title = drafts[col].trim();
    if (!title) return;
    const next: Task = {
      id: `t_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
      title,
      column: col,
      createdAt: Date.now(),
    };
    const updated = [...tasks, next];
    setTasks(updated);
    writeTasks(installationId, updated);
    setDrafts((d) => ({ ...d, [col]: "" }));
  }, [drafts, installationId, tasks]);

  const move = useCallback((id: string, col: Column) => {
    const updated = tasks.map((t) => (t.id === id ? { ...t, column: col } : t));
    setTasks(updated);
    writeTasks(installationId, updated);
  }, [installationId, tasks]);

  const remove = useCallback((id: string) => {
    const updated = tasks.filter((t) => t.id !== id);
    setTasks(updated);
    writeTasks(installationId, updated);
  }, [installationId, tasks]);

  const handleDragStart = useCallback((e: React.DragEvent<HTMLElement>, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverCol(null);
  }, []);

  const handleColDragOver = useCallback((e: React.DragEvent<HTMLElement>, col: Column) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverCol !== col) setDragOverCol(col);
  }, [dragOverCol]);

  const handleColDragLeave = useCallback((e: React.DragEvent<HTMLElement>, col: Column) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (dragOverCol === col) setDragOverCol(null);
  }, [dragOverCol]);

  const handleColDrop = useCallback((e: React.DragEvent<HTMLElement>, col: Column) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    setDragOverCol(null);
    if (!id) return;
    const task = tasks.find((t) => t.id === id);
    if (!task || task.column === col) return;
    move(id, col);
  }, [draggingId, move, tasks]);

  return (
    <PluginRuntimeShell slug={slug} bare>
    <div data-testid="task-board-runtime" className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {COLUMNS.map(({ key, icon: Icon, tint }) => {
        const col = tasks.filter((t) => t.column === key);
        return (
          <section
            key={key}
            data-testid={`task-board-col-${key}`}
            onDragOver={(e) => handleColDragOver(e, key)}
            onDragLeave={(e) => handleColDragLeave(e, key)}
            onDrop={(e) => handleColDrop(e, key)}
            className={`rounded-xl border bg-slate-50/60 dark:bg-slate-900/40 p-3 flex flex-col min-h-[280px] transition-colors ${
              dragOverCol === key
                ? "border-brand-500 ring-2 ring-brand-500/30 bg-brand-50/40 dark:bg-brand-500/10"
                : "border-slate-200 dark:border-white/10"
            }`}
          >
            <header className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
                <Icon size={12} className={tint} />
                {LABELS[key][lang] ?? LABELS[key].ru}
              </h3>
              <span className="text-[10px] text-slate-400">{col.length}</span>
            </header>
            <div className="flex-1 space-y-2 mb-2 overflow-y-auto">
              {col.map((task) => (
                <article
                  key={task.id}
                  data-testid="task-board-card"
                  data-task-id={task.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, task.id)}
                  onDragEnd={handleDragEnd}
                  className={`group rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-2.5 text-[13px] text-slate-700 dark:text-slate-200 flex items-start justify-between gap-2 cursor-grab active:cursor-grabbing select-none transition-opacity ${
                    draggingId === task.id ? "opacity-40" : ""
                  }`}
                >
                  <span className="flex-1 break-words">{task.title}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {key !== "todo" && (
                      <button
                        type="button"
                        aria-label="move left"
                        data-testid="task-board-move-left"
                        onClick={() => move(task.id, key === "done" ? "doing" : "todo")}
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-[11px] px-1"
                      >
                        ◀
                      </button>
                    )}
                    {key !== "done" && (
                      <button
                        type="button"
                        aria-label="move right"
                        data-testid="task-board-move-right"
                        onClick={() => move(task.id, key === "todo" ? "doing" : "done")}
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-[11px] px-1"
                      >
                        ▶
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="delete task"
                      data-testid="task-board-delete"
                      onClick={() => remove(task.id)}
                      className="text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                add(key);
              }}
              className="flex items-center gap-1"
            >
              <input
                type="text"
                value={drafts[key]}
                onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                placeholder={PLACEHOLDERS[lang] ?? PLACEHOLDERS.ru}
                data-testid={`task-board-input-${key}`}
                className="flex-1 text-[12px] rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500/40 text-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                data-testid={`task-board-add-${key}`}
                aria-label={t("plugins.card.install", lang)}
                className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-30 disabled:cursor-not-allowed"
                disabled={!drafts[key].trim()}
              >
                <Plus size={12} />
              </button>
            </form>
          </section>
        );
      })}
    </div>
    </PluginRuntimeShell>
  );
}
