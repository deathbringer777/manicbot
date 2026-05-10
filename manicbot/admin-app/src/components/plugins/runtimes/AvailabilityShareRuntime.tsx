"use client";

/**
 * Availability Share plugin runtime — public booking URL + QR code + copy.
 */

import { useMemo, useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { PluginRuntimeShell } from "../PluginRuntimeShell";
import type { PluginRuntimeProps } from "../runtimePanels";

const LABELS = {
  title: { ru: "Ссылка на запись", ua: "Посилання на запис", en: "Booking link", pl: "Link rezerwacji" },
  subtitle: {
    ru: "Поделитесь этой ссылкой в соцсетях или добавьте в Instagram bio.",
    ua: "Поділіться цим посиланням у соцмережах або додайте до Instagram bio.",
    en: "Share this link on social media or add it to your Instagram bio.",
    pl: "Udostępnij ten link w social media lub dodaj do Instagram bio.",
  },
  open: { ru: "Открыть", ua: "Відкрити", en: "Open", pl: "Otwórz" },
  copied: { ru: "Скопировано", ua: "Скопійовано", en: "Copied", pl: "Skopiowano" },
  copy: { ru: "Скопировать", ua: "Скопіювати", en: "Copy", pl: "Skopiuj" },
  qr: { ru: "QR-код", ua: "QR-код", en: "QR code", pl: "Kod QR" },
} as const;

export default function AvailabilityShareRuntime({ installationId, slug }: PluginRuntimeProps) {
  const { tenantId } = useRole();
  const { lang } = useLang();
  const [copied, setCopied] = useState(false);

  const url = useMemo(() => {
    if (typeof window === "undefined") return "";
    const origin = window.location.origin;
    return tenantId ? `${origin}/salon/${encodeURIComponent(tenantId)}` : `${origin}`;
  }, [tenantId]);

  const qrSrc = useMemo(() => {
    if (!url) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
  }, [url]);

  return (
    <PluginRuntimeShell slug={slug} bare>
    <div data-testid="availability-share-runtime" data-installation-id={installationId} className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 items-start">
      {qrSrc && (
        <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white p-3 self-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrSrc} alt="Booking QR" width={220} height={220} data-testid="availability-share-qr" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {LABELS.title[lang] ?? LABELS.title.ru}
        </h3>
        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
          {LABELS.subtitle[lang] ?? LABELS.subtitle.ru}
        </p>
        <div className="mt-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900/40 p-3 flex items-center gap-2 overflow-hidden">
          <code data-testid="availability-share-url" className="flex-1 text-[12px] font-mono text-slate-700 dark:text-slate-200 truncate">{url || "—"}</code>
          <button
            type="button"
            data-testid="availability-share-copy"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch { /* noop */ }
            }}
            className={`shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition-colors ${
              copied
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10"
            }`}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? LABELS.copied[lang] : LABELS.copy[lang]}
          </button>
          <a
            href={url || "#"}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="availability-share-open"
            className="shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-brand-500 text-white hover:bg-brand-600"
          >
            <ExternalLink size={11} /> {LABELS.open[lang]}
          </a>
        </div>
      </div>
    </div>
    </PluginRuntimeShell>
  );
}
