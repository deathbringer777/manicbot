"use client";

import { useState, type FormEvent } from "react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";

interface Props {
  tenantId: string;
}

// Ukrainian is 'ua' here (app convention), matching the Worker chunker + router.
const FAQ_LANGS: Lang[] = ["ru", "ua", "en", "pl"];
type LangMap = Partial<Record<Lang, string>>;

function parseLangMap(s: string | null | undefined): LangMap {
  if (!s) return {};
  try {
    const o = JSON.parse(s) as unknown;
    return o && typeof o === "object" ? (o as LangMap) : {};
  } catch {
    return {};
  }
}

interface Draft {
  id?: string;
  question: LangMap;
  answer: LangMap;
  active: boolean;
}

const EMPTY_DRAFT: Draft = { question: {}, answer: {}, active: true };

const inputCls =
  "w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-3 py-2 text-sm text-slate-900 dark:text-white outline-none placeholder:text-slate-400 dark:placeholder:text-white/30 focus:border-violet-400";

/**
 * Owner-facing FAQ editor. Writes per-language question/answer pairs to
 * `salon_faq` (via the salonFaq tRPC router); the Worker cron re-indexes them
 * into the bot's RAG knowledge base. Multilingual: edit one language at a time
 * via the language pills, all kept in the draft until save.
 */
export function SalonFaqTab({ tenantId }: Props) {
  const { lang } = useLang();
  const list = api.salonFaq.list.useQuery({ tenantId });
  const utils = api.useUtils();
  const invalidate = () => utils.salonFaq.list.invalidate({ tenantId });
  const upsert = api.salonFaq.upsert.useMutation({ onSuccess: invalidate });
  const setActive = api.salonFaq.setActive.useMutation({ onSuccess: invalidate });
  const remove = api.salonFaq.remove.useMutation({ onSuccess: invalidate });

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editLang, setEditLang] = useState<Lang>("ru");
  const [err, setErr] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string } | null>(null);

  const editing = !!draft.id;

  function resetForm() {
    setDraft(EMPTY_DRAFT);
    setEditLang("ru");
    setErr(null);
  }

  function startEdit(row: { id: string; questionJson: string | null; answerJson: string | null; active: number }) {
    setDraft({
      id: row.id,
      question: parseLangMap(row.questionJson),
      answer: parseLangMap(row.answerJson),
      active: row.active === 1,
    });
    setEditLang("ru");
    setErr(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setField(kind: "question" | "answer", value: string) {
    setDraft((d) => ({ ...d, [kind]: { ...d[kind], [editLang]: value } }));
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const hasPair = FAQ_LANGS.some((l) => draft.question[l]?.trim() && draft.answer[l]?.trim());
    if (!hasPair) {
      setErr(t("salon.faq.needPair", lang));
      return;
    }
    upsert.mutate(
      { tenantId, id: draft.id, question: draft.question, answer: draft.answer, active: draft.active, sortOrder: 0 },
      {
        onError: (e) => setErr(e.message ?? t("salon.faq.saveError", lang)),
        onSuccess: resetForm,
      },
    );
  }

  const rows = list.data ?? [];

  return (
    <div className="space-y-6">
      {/* Editor */}
      <div className="glass-card rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          {editing ? t("salon.faq.editTitle", lang) : t("salon.faq.newTitle", lang)}
        </h3>
        <p className="mb-4 mt-0.5 text-xs text-slate-500 dark:text-white/50">{t("salon.faq.subtitle", lang)}</p>
        <form onSubmit={submit} className="space-y-4">
          {/* Language pills — ● marks a language that has a complete Q+A pair */}
          <div className="flex flex-wrap gap-1.5">
            {FAQ_LANGS.map((l) => {
              const filled = !!(draft.question[l]?.trim() && draft.answer[l]?.trim());
              const active = editLang === l;
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() => setEditLang(l)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase transition ${
                    active
                      ? "bg-violet-500 text-white"
                      : "border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/[0.06]"
                  }`}
                >
                  {l}
                  {filled ? " ●" : ""}
                </button>
              );
            })}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-white/70">
              {t("salon.faq.question", lang)}
            </label>
            <textarea
              value={draft.question[editLang] ?? ""}
              onChange={(e) => setField("question", e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder={t("salon.faq.questionPlaceholder", lang)}
              className={inputCls}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-white/70">
              {t("salon.faq.answer", lang)}
            </label>
            <textarea
              value={draft.answer[editLang] ?? ""}
              onChange={(e) => setField("answer", e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={t("salon.faq.answerPlaceholder", lang)}
              className={inputCls}
            />
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-white/70">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 dark:border-white/20"
            />
            {t("salon.faq.active", lang)}
          </label>

          {err && (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-300">{err}</p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={upsert.isPending}
              className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_-6px_rgba(124,58,237,0.45)] transition hover:opacity-90 disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
            >
              {upsert.isPending ? t("salon.faq.saving", lang) : editing ? t("common.save", lang) : t("salon.faq.add", lang)}
            </button>
            {editing && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-4 py-2.5 text-sm text-slate-600 dark:text-white/70 transition hover:bg-slate-50 dark:hover:bg-white/[0.08]"
              >
                {t("common.cancel", lang)}
              </button>
            )}
          </div>
        </form>
      </div>

      {/* List */}
      <div className="glass-card rounded-2xl p-5">
        <h3 className="mb-4 text-sm font-semibold text-slate-900 dark:text-white">{t("salon.faq.listTitle", lang)}</h3>
        {list.isLoading && <p className="text-xs text-slate-500 dark:text-white/50">{t("common.loading", lang)}</p>}
        {!list.isLoading && rows.length === 0 && (
          <p className="text-xs text-slate-500 dark:text-white/50">{t("salon.faq.empty", lang)}</p>
        )}
        <div className="space-y-2">
          {rows.map((row) => {
            const q = parseLangMap(row.questionJson);
            const preview = q[lang] ?? q.ru ?? q.en ?? q.ua ?? q.pl ?? "—";
            const isActive = row.active === 1;
            return (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] px-4 py-3"
              >
                <p
                  className={`min-w-0 flex-1 truncate text-sm ${
                    isActive ? "text-slate-900 dark:text-white" : "text-slate-400 line-through dark:text-white/40"
                  }`}
                >
                  {preview}
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActive.mutate({ tenantId, id: row.id, active: !isActive })}
                    className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-600 dark:text-white/60 transition hover:bg-slate-50 dark:hover:bg-white/[0.08]"
                  >
                    {isActive ? t("salon.faq.hide", lang) : t("salon.faq.show", lang)}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(row)}
                    className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-600 dark:text-white/60 transition hover:bg-slate-50 dark:hover:bg-white/[0.08]"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete({ id: row.id, label: preview })}
                    className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-600 dark:text-white/60 transition hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-300"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        tone="danger"
        title={`${t("salon.faq.confirmDelete", lang)}`}
        description={pendingDelete?.label ?? t("common.deleteConfirmDesc", lang)}
        confirmLabel={t("common.delete", lang)}
        busy={remove.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          remove.mutate({ tenantId, id: pendingDelete.id }, { onSettled: () => setPendingDelete(null) });
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
