"use client";

/**
 * Client CRM Lite plugin runtime — private per-client notes stored in localStorage.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, Save, X } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { PluginRuntimeShell } from "../PluginRuntimeShell";
import type { PluginRuntimeProps } from "../runtimePanels";

const STORAGE = (id: string) => `manicbot_client_crm_lite_${id}`;

interface Note {
  id: string;
  client: string;
  text: string;
  updatedAt: number;
}

const LABELS = {
  title: { ru: "Заметки по клиентам", ua: "Нотатки по клієнтах", en: "Client notes", pl: "Notatki o klientach" },
  subtitle: {
    ru: "Приватные заметки мастера. Хранятся локально и недоступны владельцу салона.",
    ua: "Приватні нотатки майстра. Зберігаються локально, власник салону їх не бачить.",
    en: "Master's private notes. Stored locally — invisible to salon owner.",
    pl: "Prywatne notatki mistrza. Przechowywane lokalnie — właściciel salonu ich nie widzi.",
  },
  clientName: { ru: "Имя клиента", ua: "Ім'я клієнта", en: "Client name", pl: "Imię klienta" },
  note: { ru: "Заметка", ua: "Нотатка", en: "Note", pl: "Notatka" },
  add: { ru: "Добавить", ua: "Додати", en: "Add", pl: "Dodaj" },
  empty: { ru: "Пока нет заметок", ua: "Поки що немає нотаток", en: "No notes yet", pl: "Brak notatek" },
} as const;

function read(id: string): Note[] {
  try {
    const raw = localStorage.getItem(STORAGE(id));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as Note[] : [];
  } catch { return []; }
}
function write(id: string, list: Note[]) {
  try { localStorage.setItem(STORAGE(id), JSON.stringify(list)); } catch { /* noop */ }
}

export default function ClientCrmLiteRuntime({ installationId, slug }: PluginRuntimeProps) {
  const { lang } = useLang();
  const [notes, setNotes] = useState<Note[]>([]);
  const [client, setClient] = useState("");
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => { setNotes(read(installationId)); }, [installationId]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => n.client.toLowerCase().includes(q) || n.text.toLowerCase().includes(q));
  }, [notes, filter]);

  function update(next: Note[]) {
    setNotes(next);
    write(installationId, next);
  }

  return (
    <PluginRuntimeShell slug={slug} bare>
    <div data-testid="client-crm-lite-runtime" data-installation-id={installationId} className="space-y-4">
      <section className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/40 p-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {LABELS.title[lang]}
        </h3>
        <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
          {LABELS.subtitle[lang]}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!client.trim() || !text.trim()) return;
            const n: Note = {
              id: `n_${Math.random().toString(36).slice(2, 10)}`,
              client: client.trim(),
              text: text.trim(),
              updatedAt: Date.now(),
            };
            update([n, ...notes].slice(0, 500));
            setClient("");
            setText("");
          }}
          className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-2"
        >
          <input
            data-testid="client-crm-client-input"
            type="text"
            value={client}
            onChange={(e) => setClient(e.target.value)}
            placeholder={LABELS.clientName[lang]}
            className="text-sm rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 px-2 py-1.5 text-slate-900 dark:text-slate-100"
          />
          <input
            data-testid="client-crm-note-input"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={LABELS.note[lang]}
            className="text-sm rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 px-2 py-1.5 text-slate-900 dark:text-slate-100"
          />
          <button
            type="submit"
            data-testid="client-crm-add"
            disabled={!client.trim() || !text.trim()}
            className="inline-flex items-center justify-center gap-1 text-xs px-3 py-1.5 rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-30"
          >
            <Plus size={12} /> {LABELS.add[lang]}
          </button>
        </form>
      </section>

      <input
        data-testid="client-crm-filter"
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={LABELS.clientName[lang] + "..."}
        className="w-full text-sm rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 px-3 py-2 text-slate-900 dark:text-slate-100"
      />

      {visible.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">{LABELS.empty[lang]}</p>
      ) : (
        <ul data-testid="client-crm-list" className="space-y-2">
          {visible.map((n) => (
            <li
              key={n.id}
              className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/40 p-3 flex items-start justify-between gap-2"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{n.client}</div>
                <div className="mt-1 text-[13px] text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{n.text}</div>
                <div className="mt-1 text-[10px] text-slate-400">{new Date(n.updatedAt).toLocaleString()}</div>
              </div>
              <button
                type="button"
                onClick={() => update(notes.filter((x) => x.id !== n.id))}
                aria-label="delete"
                className="text-slate-400 hover:text-red-500"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
    </PluginRuntimeShell>
  );
}
