"use client";

/**
 * Quick Notes plugin runtime — lightweight per-installation notepad.
 * Notes stored in localStorage; max 50.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { PluginRuntimeShell } from "../PluginRuntimeShell";
import type { PluginRuntimeProps } from "../runtimePanels";

interface Note {
  id: string;
  text: string;
  createdAt: number;
}

const MAX_NOTES = 50;
const storageKey = (installationId: string) => `manicbot.quickNotes.${installationId}`;

function readNotes(installationId: string): Note[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(installationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Note[]) : [];
  } catch {
    return [];
  }
}

function writeNotes(installationId: string, notes: Note[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(installationId), JSON.stringify(notes));
  } catch { /* noop */ }
}

export default function QuickNotesRuntime({ installationId, slug }: PluginRuntimeProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setNotes(readNotes(installationId));
  }, [installationId]);

  const add = useCallback(() => {
    const text = draft.trim();
    if (!text || notes.length >= MAX_NOTES) return;
    const next: Note = {
      id: `n_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
      text,
      createdAt: Date.now(),
    };
    const updated = [next, ...notes];
    setNotes(updated);
    writeNotes(installationId, updated);
    setDraft("");
    textareaRef.current?.focus();
  }, [draft, installationId, notes]);

  const remove = useCallback((id: string) => {
    const updated = notes.filter((n) => n.id !== id);
    setNotes(updated);
    writeNotes(installationId, updated);
  }, [installationId, notes]);

  const startEdit = useCallback((note: Note) => {
    setEditId(note.id);
    setEditText(note.text);
  }, []);

  const saveEdit = useCallback(() => {
    if (!editId) return;
    const text = editText.trim();
    if (!text) {
      remove(editId);
      setEditId(null);
      return;
    }
    const updated = notes.map((n) => (n.id === editId ? { ...n, text } : n));
    setNotes(updated);
    writeNotes(installationId, updated);
    setEditId(null);
  }, [editId, editText, installationId, notes, remove]);

  const cancelEdit = useCallback(() => {
    setEditId(null);
    setEditText("");
  }, []);

  const atLimit = notes.length >= MAX_NOTES;

  return (
    <PluginRuntimeShell slug={slug} bare>
    <div data-testid="quick-notes-runtime" className="flex flex-col gap-4">
      {/* Add note */}
      <div className="flex flex-col gap-2">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              add();
            }
          }}
          placeholder="New note… (Ctrl+Enter to add)"
          rows={3}
          disabled={atLimit}
          data-testid="quick-notes-input"
          className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/30 resize-none disabled:opacity-50"
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-400 dark:text-slate-600">
            {notes.length} / {MAX_NOTES}
          </span>
          <button
            type="button"
            onClick={add}
            disabled={!draft.trim() || atLimit}
            data-testid="quick-notes-add"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus size={12} /> Add note
          </button>
        </div>
      </div>

      {/* Notes list */}
      {notes.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-600 text-center py-6">
          No notes yet. Add one above.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="quick-notes-list">
          {notes.map((note) => (
            <li
              key={note.id}
              data-testid="quick-notes-item"
              data-note-id={note.id}
              className="group rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 p-3"
            >
              {editId === note.id ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") cancelEdit();
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveEdit();
                    }}
                    autoFocus
                    rows={3}
                    className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500/30 resize-none"
                  />
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={saveEdit}
                      data-testid="quick-notes-save-edit"
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 transition-colors"
                    >
                      <Check size={11} /> Save
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
                    >
                      <X size={11} /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <p className="flex-1 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">
                    {note.text}
                  </p>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      type="button"
                      onClick={() => startEdit(note)}
                      data-testid="quick-notes-edit"
                      aria-label="Edit note"
                      className="h-6 w-6 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(note.id)}
                      data-testid="quick-notes-delete"
                      aria-label="Delete note"
                      className="h-6 w-6 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
    </PluginRuntimeShell>
  );
}
