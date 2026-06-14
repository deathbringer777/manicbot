"use client";

import { useState } from "react";
import { Instagram, Loader2, CheckSquare, Square, X, AlertCircle, ImageOff } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { toast } from "~/lib/toast";
import { Btn } from "~/components/salon/SalonShared";

interface IgMedia {
  id: string;
  mediaType: string;
  mediaUrl: string;
  thumbnailUrl: string | null;
  timestamp: string | null;
  caption: string | null;
  permalink: string | null;
}

interface Props {
  tenantId: string;
  albumId: string;
  albumName: string;
  onClose: () => void;
  onImported: () => void;
}

/**
 * Modal that fetches the tenant's Instagram media grid and lets them
 * select photos to import into the given album. Photos are downloaded
 * server-side to R2 so CDN URLs are permanent.
 */
export function InstagramImportModal({ tenantId, albumId, albumName, onClose, onImported }: Props) {
  const { lang } = useLang();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const mediaQ = api.salon.listInstagramMedia.useQuery(
    { tenantId },
    { retry: false, staleTime: 60_000 },
  );

  const importMut = api.salon.importInstagramPhotos.useMutation({
    onSuccess: (res) => {
      toast.success(`${t("salon.igImport.done", lang)} (${res.imported})`);
      onImported();
      onClose();
    },
    onError: (e) => toast.error(t("salon.igImport.fetchError", lang), e.message),
  });

  const media: IgMedia[] = mediaQ.data?.media ?? [];
  const allIds = media.map((m) => m.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }

  function handleImport() {
    if (selected.size === 0) {
      toast.error(t("salon.igImport.noneSelected", lang));
      return;
    }
    importMut.mutate({ tenantId, albumId, mediaIds: [...selected] });
  }

  const isLoading = mediaQ.isLoading;
  const notConnected = mediaQ.data?.notConnected ?? (!mediaQ.isLoading && !mediaQ.data);
  const missingScope = mediaQ.data?.missingScope ?? false;
  const hasError = !!mediaQ.error;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="relative flex flex-col w-full sm:max-w-xl max-h-[90dvh] sm:max-h-[80dvh] rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className="flex items-center gap-2">
            <Instagram className="h-5 w-5 text-pink-500" />
            <span className="font-semibold text-slate-900 dark:text-white text-sm">
              {t("salon.igImport.title", lang)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Album label */}
        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800 shrink-0 text-xs text-slate-500 dark:text-slate-400">
          {t("salon.igImport.toAlbum", lang)}{" "}
          <span className="font-medium text-slate-700 dark:text-slate-200">{albumName}</span>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : hasError || notConnected ? (
            <div className="flex flex-col items-center gap-3 py-12 px-6 text-center">
              <AlertCircle className="h-8 w-8 text-slate-400" />
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t("salon.igImport.notConnected", lang)}
              </p>
              <a
                href="/settings/channels"
                className="text-sm font-medium text-violet-600 dark:text-violet-400 underline"
              >
                {t("salon.igImport.goToChannels", lang)}
              </a>
            </div>
          ) : missingScope ? (
            <div className="flex flex-col items-center gap-3 py-12 px-6 text-center">
              <AlertCircle className="h-8 w-8 text-amber-400" />
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t("salon.igImport.missingScope", lang)}
              </p>
              <a
                href="/settings/channels"
                className="text-sm font-medium text-violet-600 dark:text-violet-400 underline"
              >
                {t("salon.igImport.reconnect", lang)}
              </a>
            </div>
          ) : media.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 px-6 text-center">
              <ImageOff className="h-8 w-8 text-slate-400" />
              <p className="text-sm text-slate-500">{t("salon.igImport.noMedia", lang)}</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-0.5 p-0.5">
              {media.map((m) => {
                const isChecked = selected.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleItem(m.id)}
                    className="relative aspect-square overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={m.thumbnailUrl ?? m.mediaUrl}
                      alt={m.caption ?? ""}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    {/* Selection overlay */}
                    <div
                      className={`absolute inset-0 transition-all ${
                        isChecked
                          ? "bg-violet-600/40 ring-2 ring-inset ring-violet-500"
                          : "bg-black/0 hover:bg-black/10"
                      }`}
                    />
                    {/* Checkbox badge */}
                    <div className={`absolute top-1.5 right-1.5 rounded ${isChecked ? "text-white" : "text-white/70"}`}>
                      {isChecked
                        ? <CheckSquare className="h-5 w-5 drop-shadow" />
                        : <Square className="h-5 w-5 drop-shadow" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {media.length > 0 && (
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-200 dark:border-slate-700 shrink-0 bg-white dark:bg-slate-900">
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition"
            >
              {allSelected
                ? t("salon.igImport.deselectAll", lang)
                : t("salon.igImport.selectAll", lang)}
            </button>
            <Btn
              onClick={handleImport}
              disabled={selected.size === 0 || importMut.isPending}
              className="py-2 px-4"
            >
              {importMut.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> {t("salon.igImport.importing", lang)}</>
              ) : (
                <>{t("salon.igImport.importSelected", lang)}{selected.size > 0 ? ` (${selected.size})` : ""}</>
              )}
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}
