"use client";

/**
 * CreateListModal — shared "new manual list" dialog.
 *
 * One entity, two surfaces: the Marketing → Kontakty "Списки клиентов" panel
 * and the Salon Clients tab "Listy" rail both create the same
 * `marketing_segments` (kind='manual') row via `segmentCreate`. Extracted so
 * the create flow lives in exactly one place.
 *
 * i18n-driven via `t(key, lang)`. `lang` defaults to "ru" so the Marketing
 * module (Russian-only by design) renders unchanged; the localized Clients
 * tab passes its active `lang`.
 */

import { useState } from "react";
import { X } from "lucide-react";
import { api } from "~/trpc/react";
import { t, type Lang } from "~/lib/i18n";

const FIELD =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-violet-500/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500";

export function CreateListModal({
  tenantId,
  lang = "ru",
  onClose,
  onCreated,
}: {
  tenantId: string;
  lang?: Lang;
  onClose: () => void;
  /** Called with the new segment id after a successful create (before close). */
  onCreated?: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const utils = api.useUtils();
  const create = api.marketingTenant.segmentCreate.useMutation({
    onSuccess: (res) => {
      void utils.marketingTenant.segmentsList.invalidate({ tenantId });
      onCreated?.(res.id);
      onClose();
    },
    onError: (e) => setErr(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) {
      setErr(t("clients.lists.modal.nameRequired", lang));
      return;
    }
    create.mutate({
      tenantId,
      name: name.trim(),
      description: description.trim() || undefined,
      kind: "manual",
      filterJson: "{}",
    });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900 dark:ring-white/5 sm:rounded-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t("clients.lists.modal.title", lang)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 dark:bg-white/5 dark:text-white/60"
            aria-label={t("clients.lists.modal.close", lang)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3 text-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-white/70">
              {t("clients.lists.modal.nameLabel", lang)} *
            </label>
            <input
              autoFocus
              type="text"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("clients.lists.modal.namePh", lang)}
              data-testid="create-list-name"
              className={FIELD}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-white/70">
              {t("clients.lists.modal.descLabel", lang)}
            </label>
            <textarea
              rows={3}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("clients.lists.modal.descPh", lang)}
              className={`${FIELD} resize-none`}
            />
          </div>
          {err && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              {err}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-white/10 dark:bg-transparent dark:text-slate-300 dark:hover:bg-white/[0.05]"
            >
              {t("clients.lists.modal.cancel", lang)}
            </button>
            <button
              type="submit"
              disabled={create.isPending || !name.trim()}
              data-testid="create-list-submit"
              className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
            >
              {create.isPending ? "…" : t("clients.lists.modal.submit", lang)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
