"use client";

/**
 * Task Board plugin runtime — 3-column Kanban backed by localStorage.
 * No server round-trip — good enough for a MVP "it actually works" demo.
 *
 * Drag-and-drop: native HTML5 DnD with explicit insertion-point drop zones
 * between every card (and one at the top + one at the bottom of each
 * column). Drop on a zone splices the dragged card to that exact position;
 * drop on a column's dead space appends to the end as a fallback. Same-
 * column reorder uses the same path. Touch devices fall back to ◀/▶.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, X, Circle, Clock, CheckCircle2 } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { PluginRuntimeShell } from "../PluginRuntimeShell";
import { useCoarsePointer } from "~/lib/useCoarsePointer";
import type { PluginRuntimeProps } from "../runtimePanels";

export type Column = "todo" | "doing" | "done";
export interface Task {
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

/**
 * Pure move/reorder helper. Returns the new tasks array, or `null` when the
 * operation is a no-op (drop on self, drop on the slot the card already
 * occupies, missing source/target). Exported for unit tests — the component
 * itself just calls this and writes to localStorage.
 *
 * `beforeId === null` means "append at the end of the target column" (which
 * is the only valid drop position in an empty column).
 */
export function computeMovedTasks(
  tasks: Task[],
  id: string,
  col: Column,
  beforeId: string | null,
): Task[] | null {
  if (beforeId === id) return null;
  const dragged = tasks.find((task) => task.id === id);
  if (!dragged) return null;
  const rest = tasks.filter((task) => task.id !== id);
  const next: Task = { ...dragged, column: col };
  let insertAt: number;
  if (beforeId !== null) {
    const idx = rest.findIndex((task) => task.id === beforeId);
    insertAt = idx === -1 ? rest.length : idx;
  } else {
    let lastIdx = -1;
    for (let i = rest.length - 1; i >= 0; i--) {
      if (rest[i]!.column === col) { lastIdx = i; break; }
    }
    insertAt = lastIdx + 1;
  }
  const updated = [...rest];
  updated.splice(insertAt, 0, next);
  const sameOrder =
    updated.length === tasks.length &&
    updated.every((task, i) => task.id === tasks[i]!.id && task.column === tasks[i]!.column);
  if (sameOrder) return null;
  return updated;
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

interface DropTarget {
  col: Column;
  beforeId: string | null;
}

function sameTarget(a: DropTarget | null, col: Column, beforeId: string | null): boolean {
  return a !== null && a.col === col && a.beforeId === beforeId;
}

export default function TaskBoardRuntime({ installationId, slug }: PluginRuntimeProps) {
  const { lang } = useLang();
  const isTouch = useCoarsePointer();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [drafts, setDrafts] = useState<Record<Column, string>>({
    todo: "",
    doing: "",
    done: "",
  });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<Column | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

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

  const commitMove = useCallback((id: string, col: Column, beforeId: string | null) => {
    const updated = computeMovedTasks(tasks, id, col, beforeId);
    if (!updated) return;
    setTasks(updated);
    writeTasks(installationId, updated);
  }, [installationId, tasks]);

  const remove = useCallback((id: string) => {
    const updated = tasks.filter((task) => task.id !== id);
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
    setDropTarget(null);
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
    setDropTarget(null);
    if (!id) return;
    // Column-level drop is the fallback when the cursor isn't on any zone:
    // append to the end of the column.
    commitMove(id, col, null);
  }, [commitMove, draggingId]);

  const handleZoneDragOver = useCallback((e: React.DragEvent<HTMLElement>, col: Column, beforeId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (!sameTarget(dropTarget, col, beforeId)) {
      setDropTarget({ col, beforeId });
    }
  }, [dropTarget]);

  const handleZoneDrop = useCallback((e: React.DragEvent<HTMLElement>, col: Column, beforeId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    setDragOverCol(null);
    setDropTarget(null);
    if (!id) return;
    commitMove(id, col, beforeId);
  }, [commitMove, draggingId]);

  return (
    <PluginRuntimeShell slug={slug} bare width="full">
    <div data-testid="task-board-runtime" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {COLUMNS.map(({ key, icon: Icon, tint }) => {
        const col = tasks.filter((task) => task.column === key);
        return (
          <section
            key={key}
            data-testid={`task-board-col-${key}`}
            onDragOver={(e) => handleColDragOver(e, key)}
            onDragLeave={(e) => handleColDragLeave(e, key)}
            onDrop={(e) => handleColDrop(e, key)}
            className={`rounded-2xl border bg-slate-50/60 dark:bg-slate-900/40 p-4 flex flex-col min-h-[clamp(320px,55vh,640px)] transition-colors ${
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
            <div className="flex-1 mb-2 overflow-y-auto">
              <DropZone
                col={key}
                beforeId={col[0]?.id ?? null}
                active={draggingId !== null && sameTarget(dropTarget, key, col[0]?.id ?? null)}
                onDragOver={handleZoneDragOver}
                onDrop={handleZoneDrop}
              />
              {col.map((task, i) => (
                <div key={task.id}>
                  <article
                    data-testid="task-board-card"
                    data-task-id={task.id}
                    draggable={!isTouch}
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    onDragEnd={handleDragEnd}
                    className={`group rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-3 text-sm text-slate-700 dark:text-slate-200 flex items-start justify-between gap-2 select-none transition-opacity ${
                      isTouch ? "" : "cursor-grab active:cursor-grabbing"
                    } ${draggingId === task.id ? "opacity-40" : ""}`}
                  >
                    <span className="flex-1 break-words leading-snug">{task.title}</span>
                    <div className={`flex items-center gap-1.5 transition-opacity ${isTouch ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                      {key !== "todo" && (
                        <button
                          type="button"
                          aria-label="move left"
                          data-testid="task-board-move-left"
                          onClick={() => commitMove(task.id, key === "done" ? "doing" : "todo", null)}
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
                          onClick={() => commitMove(task.id, key === "todo" ? "doing" : "done", null)}
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
                  <DropZone
                    col={key}
                    beforeId={col[i + 1]?.id ?? null}
                    active={draggingId !== null && sameTarget(dropTarget, key, col[i + 1]?.id ?? null)}
                    onDragOver={handleZoneDragOver}
                    onDrop={handleZoneDrop}
                  />
                </div>
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
                className="flex-1 text-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500/40 text-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                data-testid={`task-board-add-${key}`}
                aria-label={t("plugins.card.install", lang)}
                className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-30 disabled:cursor-not-allowed"
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

interface DropZoneProps {
  col: Column;
  beforeId: string | null;
  active: boolean;
  onDragOver: (e: React.DragEvent<HTMLElement>, col: Column, beforeId: string | null) => void;
  onDrop: (e: React.DragEvent<HTMLElement>, col: Column, beforeId: string | null) => void;
}

function DropZone({ col, beforeId, active, onDragOver, onDrop }: DropZoneProps) {
  return (
    <div
      data-testid={`task-board-drop-zone-${col}-${beforeId ?? "end"}`}
      data-col={col}
      data-before-id={beforeId ?? ""}
      onDragOver={(e) => onDragOver(e, col, beforeId)}
      onDrop={(e) => onDrop(e, col, beforeId)}
      className={`rounded-full transition-all ${
        active
          ? "h-2 my-1.5 bg-brand-500/70 ring-2 ring-brand-500/30"
          : "h-2 my-0.5 bg-transparent"
      }`}
    />
  );
}
