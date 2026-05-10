"use client";

/**
 * Message Templates plugin runtime.
 * Templates stored in localStorage per installation.
 * Seeds 3 default templates on first load.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, Copy, Check, Pencil, Trash2, X } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { PluginRuntimeShell } from "../PluginRuntimeShell";
import type { PluginRuntimeProps } from "../runtimePanels";

interface Template {
  id: string;
  title: string;
  body: string;
}

const storageKey = (installationId: string) => `manicbot.messageTemplates.${installationId}`;

const DEFAULTS: Record<string, Template[]> = {
  ru: [
    { id: "d1", title: "Подтверждение записи", body: "Здравствуйте! Ваша запись подтверждена. Ждём вас в указанное время. Если планы изменятся — пожалуйста, сообщите заранее." },
    { id: "d2", title: "Небольшая задержка", body: "Здравствуйте! Я немного задержусь, буду готова примерно через 15 минут. Приносим извинения за неудобства!" },
    { id: "d3", title: "Спасибо за визит", body: "Спасибо, что пришли! Будем рады снова видеть вас. Если есть вопросы — пишите!" },
  ],
  ua: [
    { id: "d1", title: "Підтвердження запису", body: "Доброго дня! Ваш запис підтверджено. Чекаємо на вас у вказаний час. Якщо плани зміняться — будь ласка, повідомте заздалегідь." },
    { id: "d2", title: "Невелика затримка", body: "Доброго дня! Я трохи затримаюся, буду готова приблизно через 15 хвилин. Вибачте за незручності!" },
    { id: "d3", title: "Дякую за візит", body: "Дякую, що завітали! Будемо раді бачити вас знову. Якщо є питання — пишіть!" },
  ],
  en: [
    { id: "d1", title: "Confirm appointment", body: "Hi! Your appointment is confirmed. Looking forward to seeing you at the scheduled time. If your plans change, please let us know in advance." },
    { id: "d2", title: "Running late notice", body: "Hi! I'm running a little late — I'll be ready in about 15 minutes. Sorry for any inconvenience!" },
    { id: "d3", title: "Thanks for visiting", body: "Thank you for coming in! Hope to see you again soon. Feel free to reach out if you have any questions!" },
  ],
  pl: [
    { id: "d1", title: "Potwierdzenie wizyty", body: "Cześć! Twoja wizyta jest potwierdzona. Czekamy na Ciebie o umówionym czasie. Jeśli plany się zmienią, daj znać wcześniej." },
    { id: "d2", title: "Mała spóźnienie", body: "Cześć! Trochę się spóźnię, będę gotowa za około 15 minut. Przepraszamy za niedogodności!" },
    { id: "d3", title: "Dziękujemy za wizytę", body: "Dziękujemy za wizytę! Mamy nadzieję wkrótce znowu Cię zobaczyć. Napisz, jeśli masz pytania!" },
  ],
};

const DEFAULTS_EN: Template[] = DEFAULTS["en"]!;

function readTemplates(installationId: string, lang: string): Template[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(installationId));
    if (!raw) return DEFAULTS[lang] ?? DEFAULTS_EN;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Template[]) : [];
  } catch {
    return DEFAULTS[lang] ?? DEFAULTS_EN;
  }
}

function writeTemplates(installationId: string, templates: Template[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(installationId), JSON.stringify(templates));
  } catch { /* noop */ }
}

const UI: Record<string, Record<string, string>> = {
  addTitle: { ru: "Название", ua: "Назва", en: "Title", pl: "Tytuł" },
  addBody: { ru: "Текст", ua: "Текст", en: "Body", pl: "Treść" },
  add: { ru: "Добавить", ua: "Додати", en: "Add", pl: "Dodaj" },
  copy: { ru: "Копировать", ua: "Копіювати", en: "Copy", pl: "Kopiuj" },
  copied: { ru: "Скопировано", ua: "Скопійовано", en: "Copied", pl: "Skopiowano" },
  edit: { ru: "Изменить", ua: "Змінити", en: "Edit", pl: "Edytuj" },
  delete: { ru: "Удалить", ua: "Видалити", en: "Delete", pl: "Usuń" },
  save: { ru: "Сохранить", ua: "Зберегти", en: "Save", pl: "Zapisz" },
  cancel: { ru: "Отмена", ua: "Скасувати", en: "Cancel", pl: "Anuluj" },
  empty: { ru: "Нет шаблонов", ua: "Немає шаблонів", en: "No templates yet", pl: "Brak szablonów" },
  newTemplate: { ru: "Новый шаблон", ua: "Новий шаблон", en: "New template", pl: "Nowy szablon" },
};

function lbl(key: string, lang: string): string {
  return UI[key]?.[lang] ?? UI[key]?.en ?? key;
}

export default function MessageTemplatesRuntime({ installationId, slug }: PluginRuntimeProps) {
  const { lang } = useLang();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");

  useEffect(() => {
    setTemplates(readTemplates(installationId, lang));
  }, [installationId, lang]);

  const copy = useCallback((tpl: Template) => {
    void navigator.clipboard.writeText(tpl.body).then(() => {
      setCopiedId(tpl.id);
      setTimeout(() => setCopiedId((prev) => (prev === tpl.id ? null : prev)), 2000);
    });
  }, []);

  const addTemplate = useCallback(() => {
    const title = newTitle.trim();
    const body = newBody.trim();
    if (!title || !body) return;
    const tpl: Template = {
      id: `t_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
      title,
      body,
    };
    const updated = [...templates, tpl];
    setTemplates(updated);
    writeTemplates(installationId, updated);
    setNewTitle("");
    setNewBody("");
    setAdding(false);
  }, [installationId, newTitle, newBody, templates]);

  const deleteTemplate = useCallback((id: string) => {
    const updated = templates.filter((t) => t.id !== id);
    setTemplates(updated);
    writeTemplates(installationId, updated);
  }, [installationId, templates]);

  const startEdit = useCallback((tpl: Template) => {
    setEditId(tpl.id);
    setEditTitle(tpl.title);
    setEditBody(tpl.body);
  }, []);

  const saveEdit = useCallback(() => {
    if (!editId) return;
    const title = editTitle.trim();
    const body = editBody.trim();
    if (!title || !body) return;
    const updated = templates.map((t) => (t.id === editId ? { ...t, title, body } : t));
    setTemplates(updated);
    writeTemplates(installationId, updated);
    setEditId(null);
  }, [editId, editTitle, editBody, installationId, templates]);

  return (
    <PluginRuntimeShell slug={slug} bare>
    <div data-testid="message-templates-runtime" className="flex flex-col gap-4">
      {/* Template list */}
      {templates.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-600 text-center py-4">
          {lbl("empty", lang)}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="message-templates-list">
          {templates.map((tpl) => (
            <li
              key={tpl.id}
              data-testid="message-templates-item"
              className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 p-3"
            >
              {editId === tpl.id ? (
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    autoFocus
                    className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500/30 w-full"
                    placeholder={lbl("addTitle", lang)}
                  />
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={3}
                    className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500/30 resize-none w-full"
                    placeholder={lbl("addBody", lang)}
                  />
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={saveEdit}
                      disabled={!editTitle.trim() || !editBody.trim()}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40 transition-colors"
                    >
                      <Check size={11} /> {lbl("save", lang)}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditId(null)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
                    >
                      <X size={11} /> {lbl("cancel", lang)}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate">{tpl.title}</p>
                    <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 line-clamp-2 whitespace-pre-wrap">{tpl.body}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => copy(tpl)}
                      data-testid="message-templates-copy"
                      className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border transition-colors ${
                        copiedId === tpl.id
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                          : "bg-white dark:bg-transparent text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5"
                      }`}
                    >
                      {copiedId === tpl.id ? <><Check size={11} /> {lbl("copied", lang)}</> : <><Copy size={11} /> {lbl("copy", lang)}</>}
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(tpl)}
                      aria-label={lbl("edit", lang)}
                      className="h-6 w-6 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteTemplate(tpl.id)}
                      aria-label={lbl("delete", lang)}
                      data-testid="message-templates-delete"
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

      {/* Add new */}
      {adding ? (
        <div className="rounded-xl border border-brand-500/30 bg-brand-50/30 dark:bg-brand-500/5 p-3 flex flex-col gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            autoFocus
            placeholder={lbl("addTitle", lang)}
            className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500/30 w-full"
          />
          <textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            rows={3}
            placeholder={lbl("addBody", lang)}
            className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500/30 resize-none w-full"
          />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={addTemplate}
              disabled={!newTitle.trim() || !newBody.trim()}
              data-testid="message-templates-add-confirm"
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-xl bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40 transition-colors"
            >
              <Check size={11} /> {lbl("add", lang)}
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setNewTitle(""); setNewBody(""); }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-xl bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
            >
              <X size={11} /> {lbl("cancel", lang)}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          data-testid="message-templates-add"
          className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl border border-dashed border-slate-300 dark:border-white/15 text-slate-500 dark:text-slate-400 hover:border-brand-500/50 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
        >
          <Plus size={12} /> {lbl("newTemplate", lang)}
        </button>
      )}
    </div>
    </PluginRuntimeShell>
  );
}
