"use client";

/**
 * ImportClientsModal — CSV upload UI for bulk client import.
 *
 * Flow:
 *   1. File picker (or paste-text fallback).
 *   2. Auto-runs `dryRun=true` on file change → preview parse stats.
 *   3. "Import" button runs the real import; result summary replaces preview.
 *   4. "Download template" → `clients.csvTemplate` query.
 *
 * Errors per row are surfaced grouped — no popup, just a scrollable list.
 */

import { useEffect, useRef, useState } from "react";
import { X, Upload, FileText, Download } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

interface Props {
  tenantId: string;
  onClose: () => void;
}

export function ImportClientsModal({ tenantId, onClose }: Props) {
  const { lang } = useLang();
  const [csv, setCsv] = useState<string>("");
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const utils = api.useUtils();
  const tpl = api.clients.csvTemplate.useQuery({ tenantId });

  const dryRun = api.clients.importCsv.useMutation();
  const realRun = api.clients.importCsv.useMutation({
    onSuccess: () => {
      void utils.clients.list.invalidate({ tenantId });
    },
  });

  const result = realRun.data ?? dryRun.data;

  // Auto-run dry-run whenever csv changes (debounced via useEffect — single
  // pass, no timer, because file upload is rare and synchronous in the UI).
  useEffect(() => {
    if (!csv.trim()) return;
    dryRun.mutate({ tenantId, csv, dryRun: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csv]);

  function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 1_000_000) {
      alert("CSV exceeds 1 MB limit");
      return;
    }
    setFileName(f.name);
    f.text().then(setCsv);
  }

  function downloadTemplate() {
    if (!tpl.data) return;
    const blob = new Blob([tpl.data.data], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = tpl.data.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900 dark:ring-white/5 sm:rounded-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t("clients.import.title", lang)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 dark:bg-white/5 dark:text-white/60"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Stack the two action buttons on mobile (full-width, touch-friendly)
            and inline them on tablet+. */}
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5 sm:py-1.5"
            data-testid="ic-pick-file"
          >
            <Upload className="h-3.5 w-3.5 shrink-0" />
            <span>{t("clients.import.upload", lang)}</span>
          </button>
          <button
            type="button"
            onClick={downloadTemplate}
            disabled={!tpl.data}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5 sm:py-1.5"
          >
            <Download className="h-3.5 w-3.5 shrink-0" />
            <span>{t("clients.import.template", lang)}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>

        {fileName && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:bg-white/[0.04] dark:text-slate-300">
            <FileText className="h-3.5 w-3.5 text-slate-400" />
            <span className="truncate">{fileName}</span>
          </div>
        )}

        {result && (
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <Stat label={t("clients.import.created", lang)} value={result.created} color="emerald" />
              <Stat label={t("clients.import.updated", lang)} value={result.updated} color="sky" />
              <Stat label={t("clients.import.skipped", lang)} value={result.skipped.length} color="rose" />
            </div>
            <p className="text-[11px] text-slate-500">
              {t("clients.import.total", lang)}: {result.total}
            </p>

            {result.skipped.length > 0 && (
              <details className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-white/[0.04]">
                <summary className="cursor-pointer text-slate-600 dark:text-slate-300">
                  {t("clients.import.skipped", lang)} ({result.skipped.length})
                </summary>
                <ul className="mt-2 max-h-32 overflow-y-auto space-y-1 text-rose-600 dark:text-rose-300">
                  {result.skipped.map((s: { row: number; reason: string }, i: number) => (
                    <li key={i}>
                      row {s.row}: {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {result.preview && result.preview.length > 0 && (
              <details className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-white/[0.04]">
                <summary className="cursor-pointer text-slate-600 dark:text-slate-300">
                  {t("clients.import.preview", lang)} ({result.preview.length})
                </summary>
                <ul className="mt-2 max-h-32 overflow-y-auto space-y-1 text-slate-600 dark:text-slate-300">
                  {result.preview.map((r: any, i: number) => (
                    <li key={i} className="truncate">
                      {r.name ?? "—"} · {r.phone ?? r.email ?? r.tgUsername ?? r.igUsername ?? "—"}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {/* Sticky submit row on mobile so the import action is always
            within thumb reach below the (potentially long) preview list. */}
        <div className="sticky bottom-0 -mx-4 -mb-4 mt-4 flex gap-2 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:mb-0 sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0 sm:pt-2 dark:border-white/5 dark:bg-slate-900/95 sm:dark:bg-transparent">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-200 bg-slate-100 py-3 text-sm font-medium text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/80 sm:py-2.5"
          >
            {t("common.cancel", lang)}
          </button>
          <button
            type="button"
            disabled={!csv.trim() || realRun.isPending || (result && result === realRun.data)}
            onClick={() => realRun.mutate({ tenantId, csv })}
            data-testid="ic-run"
            className={
              !csv.trim() || realRun.isPending
                ? "flex-1 cursor-not-allowed rounded-lg bg-slate-200 py-3 text-sm font-semibold text-slate-400 dark:bg-slate-700 dark:text-slate-500 sm:py-2.5"
                : "flex-1 rounded-lg py-3 text-sm font-semibold text-white shadow transition hover:opacity-90 sm:py-2.5"
            }
            style={!csv.trim() || realRun.isPending ? undefined : { background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
          >
            {realRun.isPending ? t("clients.import.running", lang) : t("clients.import.run", lang)}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: "emerald" | "sky" | "rose" }) {
  const colorMap = {
    emerald: "bg-emerald-500/10 text-emerald-400",
    sky: "bg-sky-500/10 text-sky-400",
    rose: "bg-rose-500/10 text-rose-400",
  };
  return (
    <div className={`rounded-lg p-2 text-center ${colorMap[color]}`}>
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] uppercase tracking-wide">{label}</p>
    </div>
  );
}
