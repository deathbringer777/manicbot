"use client";

import { useState } from "react";
import { Copy, Download, QrCode, Check, Loader2, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

/**
 * Generates tracking links (Telegram deep-link, public profile) with a shared
 * source/campaign tag. Uses the analytics.buildTrackingLinks tRPC procedure to
 * mint a token that the Worker's /start parser can decode back into
 * `user_origins.first_source` / `first_campaign`.
 */
export function TrackingLinksGenerator({
  tenantId,
  botUsername,
  slug,
}: {
  tenantId: string;
  botUsername?: string | null;
  slug?: string | null;
}) {
  const { lang } = useLang();
  const [source, setSource] = useState("qr");
  const [medium, setMedium] = useState("");
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [showQr, setShowQr] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const build = api.analytics.buildTrackingLinks.useQuery(
    {
      tenantId,
      source,
      medium: medium || undefined,
      campaign: campaign || undefined,
      content: content || undefined,
      botUsername: botUsername || undefined,
      slug: slug || undefined,
    },
    {
      enabled: !!source,
      retry: false,
      refetchOnWindowFocus: false,
    },
  );

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked in iframe */
    }
  }

  function downloadQrPng(svgEl: SVGSVGElement | null, filename: string) {
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgEl);
    const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 512, 512);
      ctx.drawImage(img, 0, 0, 512, 512);
      URL.revokeObjectURL(svgUrl);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, "image/png");
    };
    img.src = svgUrl;
  }

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("tracking.source", lang)} *</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500"
            >
              <option value="qr">{t("analytics.source.qr", lang)}</option>
              <option value="website">{t("analytics.source.website", lang)}</option>
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="facebook">Facebook</option>
              <option value="google_maps">Google Maps</option>
              <option value="flyer">{t("analytics.source.flyer", lang)}</option>
              <option value="sms">SMS</option>
              <option value="other">{t("analytics.source.other", lang)}</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("tracking.campaign", lang)}</label>
            <input
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
              placeholder={t("tracking.campaign.ph", lang)}
              className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500"
            />
          </div>
        </div>

        <button
          type="button"
          data-testid="tracking-advanced-toggle"
          data-open={showAdvanced ? "1" : "0"}
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
        >
          {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {t("tracking.advanced", lang)}
        </button>

        {showAdvanced && (
          <div data-testid="tracking-advanced-fields" className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("tracking.channel", lang)}</label>
              <input
                value={medium}
                onChange={(e) => setMedium(e.target.value)}
                placeholder={t("tracking.channel.ph", lang)}
                className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("tracking.content", lang)}</label>
              <input
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t("tracking.content.ph", lang)}
                className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-brand-500"
              />
            </div>
          </div>
        )}
      </div>

      {build.isLoading && (
        <div className="flex items-center justify-center py-6 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {build.isError && (
        <div className="glass-card rounded-2xl p-4 text-sm text-red-500">
          {build.error.message}
        </div>
      )}

      {build.data && (
        <div className="space-y-3">
          {build.data.token.length > 64 && (
            <div data-testid="tracking-token-warning" className="rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs px-3 py-2 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              <span>{t("tracking.tooLong", lang)}</span>
            </div>
          )}
          {build.data.links.length === 0 && (
            <div className="glass-card rounded-2xl p-4 text-xs text-slate-500">
              {t("tracking.connectFirst", lang)}
            </div>
          )}
          {build.data.links.map((link) => {
            const qrId = `qr-${link.label}`;
            return (
              <div key={link.label} className="glass-card rounded-2xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{link.label}</p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => copy(link.url)}
                      className="h-7 w-7 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500"
                      aria-label={t("tracking.copy", lang)}
                    >
                      {copied === link.url ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowQr(showQr === qrId ? null : qrId)}
                      className="h-7 w-7 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500"
                      aria-label={t("tracking.qrCode", lang)}
                    >
                      <QrCode className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-slate-700 dark:text-slate-300 break-all font-mono">{link.url}</p>
                {showQr === qrId && (
                  <div className="mt-2 flex flex-col items-center gap-2 border-t border-slate-200 dark:border-white/5 pt-3">
                    <div className="bg-white p-3 rounded-xl" data-qr-wrapper={qrId}>
                      <QRCodeSVG value={link.url} size={192} level="M" />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const wrapper = document.querySelector(`[data-qr-wrapper="${qrId}"]`);
                        const svg = wrapper?.querySelector("svg") as SVGSVGElement | null;
                        const fname = `tracking-${source}${campaign ? `-${campaign}` : ""}.png`;
                        downloadQrPng(svg, fname);
                      }}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
                    >
                      <Download className="h-3.5 w-3.5" />
                      PNG
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
