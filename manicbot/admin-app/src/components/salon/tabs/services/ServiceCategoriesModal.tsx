"use client";

/**
 * ServiceCategoriesModal — manage the per-tenant list of service categories.
 *
 * UX shape:
 *   - List of current categories with usage count, inline rename, up/down
 *     reorder, delete (with reassign-or-clear confirm).
 *   - New-category row at the bottom.
 *
 * Skips drag-and-drop on purpose: up/down chevrons cover the typical 3-8
 * category case with zero added deps, no pointer-handler edge cases, and
 * good keyboard support on iPad / desktop. If we ever need DnD we can swap
 * in @dnd-kit (already a dependency) without changing the data layer.
 *
 * Stacking: follows the 0062 modal contract — z-[100] overlay, solid card
 * with `ring-1 ring-black/5`. The delete-confirm renders nested at z-[110]
 * so it sits on top of this modal.
 */

import { useEffect, useState } from "react";
import {
  X, Plus, ChevronUp, ChevronDown, Trash2, Pencil, Check, Loader2, AlertCircle,
} from "lucide-react";
import { api } from "~/trpc/react";
import { Select } from "~/components/ui/Select";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

interface Props {
  tenantId: string;
  onClose: () => void;
}

interface CatRow {
  id: string;
  name: string;
  sortOrder: number;
  usageCount: number;
}

export function ServiceCategoriesModal({ tenantId, onClose }: Props) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const list = api.salon.serviceCategoriesList.useQuery({ tenantId });
  const cats: CatRow[] = list.data ?? [];

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CatRow | null>(null);
  const [error, setError] = useState<string>("");

  function invalidate() {
    void utils.salon.serviceCategoriesList.invalidate({ tenantId });
    void utils.salon.listServiceCategories.invalidate({ tenantId });
    void utils.salon.getServices.invalidate({ tenantId });
  }

  const create = api.salon.createServiceCategory.useMutation({
    onSuccess: () => { setNewName(""); setError(""); invalidate(); },
    onError: (e) => setError(e.message || "Не удалось создать категорию"),
  });

  const rename = api.salon.renameServiceCategory.useMutation({
    onSuccess: () => { setEditingId(null); setError(""); invalidate(); },
    onError: (e) => setError(e.message || "Не удалось переименовать"),
  });

  const reorder = api.salon.reorderServiceCategories.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => setError(e.message || "Не удалось переупорядочить"),
  });

  const remove = api.salon.deleteServiceCategory.useMutation({
    onSuccess: () => { setDeleteTarget(null); setError(""); invalidate(); },
    onError: (e) => setError(e.message || "Не удалось удалить"),
  });

  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    create.mutate({ tenantId, name });
  }

  function startEdit(c: CatRow) {
    setEditingId(c.id);
    setEditValue(c.name);
    setError("");
  }

  function saveEdit(c: CatRow) {
    const newName = editValue.trim();
    if (!newName || newName === c.name) {
      setEditingId(null);
      return;
    }
    rename.mutate({ tenantId, id: c.id, newName });
  }

  function move(c: CatRow, direction: -1 | 1) {
    const idx = cats.findIndex(x => x.id === c.id);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= cats.length) return;
    const next = [...cats];
    const tmp = next[idx]!;
    next[idx] = next[newIdx]!;
    next[newIdx] = tmp;
    reorder.mutate({ tenantId, ids: next.map(c => c.id) });
  }

  const isBusy = create.isPending || rename.isPending || reorder.isPending || remove.isPending;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md"
      onClick={onClose}
      onKeyDown={e => e.key === "Escape" && onClose()}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-slate-900 ring-1 ring-black/5 dark:ring-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92dvh]"
        onClick={e => e.stopPropagation()}
        data-testid="service-categories-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100 dark:border-white/5 shrink-0">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            {t("salon.services.categories.title", lang)}
          </h3>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-xl bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {list.isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
            </div>
          )}

          {!list.isLoading && cats.length === 0 && (
            <div className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">
              {t("salon.services.categories.empty", lang)}
            </div>
          )}

          {cats.map((c, idx) => {
            const isEditing = editingId === c.id;
            return (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] px-3 py-2"
              >
                {/* Reorder chevrons */}
                <div className="flex flex-col -my-1">
                  <button
                    onClick={() => move(c, -1)}
                    disabled={idx === 0 || isBusy}
                    className="h-5 w-5 flex items-center justify-center text-slate-400 hover:text-brand-500 disabled:opacity-30 disabled:hover:text-slate-400"
                    aria-label={t("salon.services.categories.moveUp", lang)}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => move(c, 1)}
                    disabled={idx === cats.length - 1 || isBusy}
                    className="h-5 w-5 flex items-center justify-center text-slate-400 hover:text-brand-500 disabled:opacity-30 disabled:hover:text-slate-400"
                    aria-label={t("salon.services.categories.moveDown", lang)}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>

                {/* Name (read or edit) */}
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") saveEdit(c);
                        else if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                      maxLength={60}
                      className="w-full bg-white dark:bg-slate-800 border border-brand-400 dark:border-brand-400 text-slate-900 dark:text-white rounded-lg px-2 py-1 text-sm focus:outline-none"
                      data-testid={`category-rename-input-${c.id}`}
                    />
                  ) : (
                    <button
                      onClick={() => startEdit(c)}
                      className="w-full text-left text-sm font-medium text-slate-900 dark:text-white hover:text-brand-500 dark:hover:text-brand-300 transition-colors truncate"
                      data-testid={`category-name-${c.id}`}
                    >
                      {c.name}
                    </button>
                  )}
                </div>

                {/* Usage count badge */}
                {!isEditing && (
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-400"
                    title={t("salon.services.categories.usageTooltip", lang)}
                  >
                    {c.usageCount}
                  </span>
                )}

                {/* Action buttons */}
                {isEditing ? (
                  <button
                    onClick={() => saveEdit(c)}
                    disabled={isBusy}
                    className="h-7 w-7 flex items-center justify-center rounded-lg bg-brand-500/15 text-brand-500 hover:bg-brand-500/25 disabled:opacity-50"
                    aria-label={t("common.save", lang)}
                    data-testid={`category-save-${c.id}`}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => startEdit(c)}
                      className="h-7 w-7 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
                      aria-label={t("action.edit", lang)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => { setDeleteTarget(c); setError(""); }}
                      disabled={isBusy}
                      className="h-7 w-7 flex items-center justify-center rounded-lg bg-red-500/10 text-red-400/80 hover:text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                      aria-label={t("action.delete", lang)}
                      data-testid={`category-delete-${c.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            );
          })}

          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-xl">
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Footer — new category */}
        <div className="border-t border-slate-100 dark:border-white/5 px-5 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
              placeholder={t("salon.services.categories.addPlaceholder", lang)}
              maxLength={60}
              className="flex-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-slate-400 dark:placeholder:text-slate-600"
              data-testid="category-new-input"
            />
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || isBusy}
              className="flex items-center gap-1 px-3 py-2 rounded-xl bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="category-new-add"
            >
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              <span>{t("common.add", lang)}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Delete confirmation (nested at z-[110]) */}
      {deleteTarget && (
        <DeleteCategoryConfirm
          target={deleteTarget}
          allCategories={cats}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={(reassignToId) => remove.mutate({ tenantId, id: deleteTarget.id, reassignToId })}
          isBusy={remove.isPending}
        />
      )}
    </div>
  );
}

// ─── Delete confirm ──────────────────────────────────────────────────────

interface DeleteProps {
  target: CatRow;
  allCategories: CatRow[];
  onCancel: () => void;
  onConfirm: (reassignToId: string | null) => void;
  isBusy: boolean;
}

function DeleteCategoryConfirm({ target, allCategories, onCancel, onConfirm, isBusy }: DeleteProps) {
  const { lang } = useLang();
  const [reassignTo, setReassignTo] = useState<string>(""); // "" = clear (set to null)

  // Reassign target options: every other category in this tenant.
  const otherCats = allCategories.filter(c => c.id !== target.id);

  // Reset escape handler on mount.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const options = [
    { value: "", label: t("salon.services.categories.deleteClearOption", lang) },
    ...otherCats.map(c => ({ value: c.id, label: c.name })),
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm bg-white dark:bg-slate-900 ring-1 ring-black/5 dark:ring-white/10 rounded-2xl shadow-2xl p-5 space-y-4"
        onClick={e => e.stopPropagation()}
        data-testid="category-delete-confirm"
      >
        <h4 className="text-base font-bold text-slate-900 dark:text-white">
          {t("salon.services.categories.deleteTitle", lang)}
        </h4>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {target.usageCount > 0
            ? t("salon.services.categories.deleteWithUsage", lang).replace("{count}", String(target.usageCount)).replace("{name}", target.name)
            : t("salon.services.categories.deleteNoUsage", lang).replace("{name}", target.name)
          }
        </p>

        {target.usageCount > 0 && (
          <div>
            <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-1.5 block">
              {t("salon.services.categories.reassignLabel", lang)}
            </label>
            <Select
              value={reassignTo}
              onChange={setReassignTo}
              options={options}
              testIdPrefix="category-reassign"
            />
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={isBusy}
            className="flex-1 px-3 py-2 rounded-xl bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 text-sm font-medium hover:bg-slate-200 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            {t("action.cancel", lang)}
          </button>
          <button
            onClick={() => onConfirm(reassignTo || null)}
            disabled={isBusy}
            className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
            data-testid="category-delete-confirm-btn"
          >
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            <span>{t("action.delete", lang)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
