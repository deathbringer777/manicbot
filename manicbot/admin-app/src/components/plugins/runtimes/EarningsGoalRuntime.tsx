"use client";

/**
 * Earnings Goal plugin runtime — monthly goal slider + progress from localStorage.
 *
 * MVP: goal stored in localStorage, progress derived from optional entries
 * the user adds right here. Full integration with api.salon.getAppointments
 * would follow when the plugin graduates from beta.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, Target, TrendingUp, X } from "lucide-react";
import { useLang } from "~/components/LangContext";
import type { PluginRuntimeProps } from "../runtimePanels";

const STORAGE = (id: string) => `manicbot_earnings_goal_${id}`;

interface Entry {
  id: string;
  amount: number;
  note: string;
  at: number;
}

interface State {
  goal: number;
  entries: Entry[];
}

function read(id: string): State {
  if (typeof window === "undefined") return { goal: 20000, entries: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE(id));
    if (!raw) return { goal: 20000, entries: [] };
    const parsed = JSON.parse(raw) as State;
    return {
      goal: typeof parsed.goal === "number" ? parsed.goal : 20000,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { goal: 20000, entries: [] };
  }
}

function write(id: string, state: State) {
  try { localStorage.setItem(STORAGE(id), JSON.stringify(state)); } catch { /* noop */ }
}

const LABELS = {
  goalHeader: { ru: "Цель на месяц", ua: "Ціль на місяць", en: "Monthly goal", pl: "Cel miesięczny" },
  progressHeader: { ru: "Прогресс", ua: "Прогрес", en: "Progress", pl: "Postęp" },
  addHeader: { ru: "Добавить визит", ua: "Додати візит", en: "Add visit", pl: "Dodaj wizytę" },
  amount: { ru: "Сумма", ua: "Сума", en: "Amount", pl: "Kwota" },
  note: { ru: "Комментарий", ua: "Коментар", en: "Note", pl: "Notatka" },
  add: { ru: "Добавить", ua: "Додати", en: "Add", pl: "Dodaj" },
  history: { ru: "История", ua: "Історія", en: "History", pl: "Historia" },
  empty: { ru: "Пока пусто", ua: "Поки що порожньо", en: "Nothing yet", pl: "Jeszcze nic" },
} as const;

export default function EarningsGoalRuntime({ installationId }: PluginRuntimeProps) {
  const { lang } = useLang();
  const [state, setState] = useState<State>({ goal: 20000, entries: [] });
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => { setState(read(installationId)); }, [installationId]);

  const total = useMemo(() => state.entries.reduce((a, e) => a + e.amount, 0), [state.entries]);
  const pct = state.goal > 0 ? Math.min(100, (total / state.goal) * 100) : 0;

  function update(next: State) {
    setState(next);
    write(installationId, next);
  }

  return (
    <div data-testid="earnings-goal-runtime" data-installation-id={installationId} className="space-y-4">
      <section className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/40 p-4">
        <header className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
            <Target size={12} /> {LABELS.goalHeader[lang]}
          </h3>
          <span data-testid="earnings-goal-total" className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {total.toLocaleString()} / {state.goal.toLocaleString()} zł
          </span>
        </header>
        <input
          type="range"
          min={0}
          max={100000}
          step={1000}
          value={state.goal}
          onChange={(e) => update({ ...state, goal: Number(e.target.value) })}
          data-testid="earnings-goal-slider"
          className="w-full accent-brand-500"
        />
        <div className="mt-3 h-2 rounded-full bg-slate-100 dark:bg-white/[0.04] overflow-hidden">
          <div
            data-testid="earnings-goal-progress-bar"
            style={{ width: `${pct}%` }}
            className="h-full bg-gradient-to-r from-brand-500 to-emerald-500 transition-all duration-500"
          />
        </div>
        <p className="mt-2 text-[11px] text-slate-400 inline-flex items-center gap-1">
          <TrendingUp size={11} /> {pct.toFixed(1)}%
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/40 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
          {LABELS.addHeader[lang]}
        </h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const amt = Number(amount);
            if (!amt || !Number.isFinite(amt)) return;
            const entry: Entry = {
              id: `e_${Math.random().toString(36).slice(2, 10)}`,
              amount: amt,
              note: note.trim(),
              at: Date.now(),
            };
            update({ ...state, entries: [entry, ...state.entries].slice(0, 200) });
            setAmount("");
            setNote("");
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <input
            data-testid="earnings-goal-amount-input"
            type="number"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={LABELS.amount[lang]}
            min={0}
            className="w-full sm:w-32 text-sm rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 px-2 py-1.5 text-slate-900 dark:text-slate-100"
          />
          <input
            data-testid="earnings-goal-note-input"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={LABELS.note[lang]}
            className="flex-1 text-sm rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 px-2 py-1.5 text-slate-900 dark:text-slate-100"
          />
          <button
            type="submit"
            data-testid="earnings-goal-add"
            disabled={!amount}
            className="inline-flex items-center justify-center gap-1 text-xs px-3 py-1.5 rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-30"
          >
            <Plus size={12} /> {LABELS.add[lang]}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/40 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
          {LABELS.history[lang]}
        </h3>
        {state.entries.length === 0 ? (
          <p className="text-sm text-slate-400">{LABELS.empty[lang]}</p>
        ) : (
          <ul className="space-y-1.5" data-testid="earnings-goal-history">
            {state.entries.slice(0, 10).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex-1 min-w-0 truncate text-slate-700 dark:text-slate-200">
                  <span className="font-semibold">{e.amount.toLocaleString()} zł</span>
                  {e.note && <span className="ml-2 text-slate-500 dark:text-slate-400">{e.note}</span>}
                </span>
                <span className="text-[10px] text-slate-400">
                  {new Date(e.at).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  onClick={() => update({ ...state, entries: state.entries.filter((x) => x.id !== e.id) })}
                  className="text-slate-400 hover:text-red-500"
                  aria-label="delete"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
