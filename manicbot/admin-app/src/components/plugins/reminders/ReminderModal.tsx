"use client";

/**
 * ReminderModal — create-only modal for one-shot reminders + recurring
 * routines. Triggered from QuickAddFab extraItems ("+ Reminder" /
 * "+ Routine"). Backend lives at `appRouter.pluginReminders.create`.
 *
 * Kept deliberately compact for MVP — recurrence picker is a simple
 * <select> with three presets (Once / Daily / Weekly Mon–Fri); deeper
 * pickers (custom weekdays, monthly_day) land in a follow-up. The full
 * recurrence DSL on the backend can already accept them — this is a UI
 * limitation, not a data-model one.
 */

import { useState } from "react";
import { X, Bell, Repeat } from "lucide-react";
import { api } from "~/trpc/react";
import { Select } from "~/components/ui/Select";

interface Props {
  tenantId: string;
  defaultKind?: "reminder" | "routine";
  /** Optional pre-selected target master (chat_id). */
  defaultTargetMasterId?: number | null;
  onClose: () => void;
  onCreated?: (id: string) => void;
}

type PresetRecurrence = "once" | "daily" | "weekly-weekdays";

function presetToDsl(p: PresetRecurrence, time: string) {
  if (p === "once") return { type: "once" as const };
  if (p === "daily") return { type: "daily" as const, time };
  return { type: "weekly" as const, time, weekdays: [1, 2, 3, 4, 5] };
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ReminderModal({ tenantId, defaultKind = "reminder", defaultTargetMasterId, onClose, onCreated }: Props) {
  const [kind, setKind] = useState<"reminder" | "routine">(defaultKind);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [startsOn, setStartsOn] = useState(todayIso());
  const [time, setTime] = useState("09:00");
  const [preset, setPreset] = useState<PresetRecurrence>(defaultKind === "routine" ? "weekly-weekdays" : "once");
  const [telegramDup, setTelegramDup] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = api.pluginReminders.create.useMutation({
    onSuccess: (res) => {
      onCreated?.(res.id);
      onClose();
    },
    onError: (e) => setErr(e.message),
  });

  const submit = () => {
    if (!title.trim()) {
      setErr("Заголовок обязателен");
      return;
    }
    create.mutate({
      tenantId,
      kind,
      title: title.trim(),
      note: note.trim() || null,
      startsOn,
      time,
      recurrence: presetToDsl(preset, time),
      targetMasterId: defaultTargetMasterId ?? null,
      channels: telegramDup ? ["inapp", "telegram"] : ["inapp"],
    });
  };

  const Icon = kind === "routine" ? Repeat : Bell;
  const accent = kind === "routine" ? "text-emerald-500" : "text-indigo-500";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 shadow-2xl ring-1 ring-black/5 dark:ring-white/5"
        data-testid="reminder-modal"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-white/5">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${accent}`} />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              {kind === "routine" ? "Новая рутина" : "Новое напоминание"}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setKind("reminder"); setPreset((p) => p === "weekly-weekdays" ? "once" : p); }}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                kind === "reminder"
                  ? "border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"
                  : "border-slate-200 dark:border-white/10 text-slate-500"
              }`}
            >
              Напоминание
            </button>
            <button
              type="button"
              onClick={() => { setKind("routine"); setPreset("weekly-weekdays"); }}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                kind === "routine"
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                  : "border-slate-200 dark:border-white/10 text-slate-500"
              }`}
            >
              Рутина
            </button>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">Заголовок</label>
            <input
              type="text"
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Закрыть кассу"
              className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
              data-testid="reminder-title"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">Заметка (необязательно)</label>
            <textarea
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">Дата</label>
              <input
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">Время</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1">Повтор</label>
            <Select
              value={preset}
              onChange={(v) => setPreset(v as PresetRecurrence)}
              options={[
                { value: "once", label: "Один раз" },
                { value: "daily", label: "Каждый день" },
                { value: "weekly-weekdays", label: "По будням (Пн–Пт)" },
              ]}
              testIdPrefix="reminder-preset"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={telegramDup}
              onChange={(e) => setTelegramDup(e.target.checked)}
              className="rounded border-slate-300"
            />
            Дублировать в Telegram (если привязан)
          </label>

          {err && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
              {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 dark:border-white/5">
          <button
            type="button"
            onClick={onClose}
            disabled={create.isPending}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={create.isPending || !title.trim()}
            data-testid="reminder-save"
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-br from-indigo-500 to-cyan-500 hover:opacity-90 disabled:opacity-50"
          >
            {create.isPending ? "Создаём..." : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}
