"use client";

import { useState } from "react";
import { Loader2, Send, X, CheckCircle, AlertCircle } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

/**
 * Test-message dialog for the connected IG channel. Lets the salon owner
 * confirm the bot can actually send a DM to a real PSID — the canonical
 * diagnostic for "is my channel wired".
 *
 * The Worker `/admin/ig-send-test` endpoint deliberately bypasses the local
 * 24h-window cache so Meta's own answer (`outside_message_window` etc.)
 * surfaces here as the verdict. That makes the dialog twice as useful:
 * if the PSID hasn't messaged the bot in 24h the operator sees the real
 * Meta constraint rather than our pre-rejection.
 */
export function IGSendTestDialog({
  tenantId,
  onClose,
}: {
  tenantId: string;
  onClose: () => void;
}) {
  const { lang } = useLang();
  const [psid, setPsid] = useState("");
  const [text, setText] = useState("");
  const [result, setResult] = useState<
    | { kind: "idle" }
    | { kind: "success"; api: string | null }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const sendMut = api.salon.sendInstagramTestMessage.useMutation({
    onSuccess: (data) => setResult({ kind: "success", api: data.api ?? null }),
    onError: (e) => setResult({ kind: "error", message: e.message }),
  });

  return (
    <div
      data-testid="ig-send-test-dialog"
      className="fixed inset-0 z-[100] bg-slate-950/70 backdrop-blur-md flex items-center justify-center px-4"
      onClick={(e) => { if (e.target === e.currentTarget && !sendMut.isPending) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-black/5 shadow-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {t("channels.ig.test.title", lang)}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("channels.ig.test.subtitle", lang)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={sendMut.isPending}
            className="rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!psid.trim()) return;
            setResult({ kind: "idle" });
            sendMut.mutate({
              tenantId,
              psid: psid.trim(),
              text: text.trim() || undefined,
            });
          }}
          className="space-y-3"
        >
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
              {t("channels.ig.test.psidLabel", lang)}
            </label>
            <input
              type="text"
              value={psid}
              onChange={(e) => setPsid(e.target.value)}
              placeholder="17841437..."
              required
              className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-pink-500/60 text-slate-900 dark:text-white font-mono"
            />
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
              {t("channels.ig.test.psidHint", lang)}
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
              {t("channels.ig.test.messageLabel", lang)}
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder={t("channels.ig.test.messagePlaceholder", lang)}
              className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-pink-500/60 text-slate-900 dark:text-white resize-none"
            />
          </div>

          {result.kind === "success" && (
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5 flex items-start gap-2 text-xs text-emerald-400">
              <CheckCircle className="h-3.5 w-3.5 mt-px shrink-0" />
              <span>
                {t("channels.ig.test.success", lang)}
                {result.api && <code className="ml-2 text-[10px] opacity-70">api={result.api}</code>}
              </span>
            </div>
          )}
          {result.kind === "error" && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2.5 flex items-start gap-2 text-xs text-red-400">
              <AlertCircle className="h-3.5 w-3.5 mt-px shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium">{t("channels.ig.test.failed", lang)}</p>
                <p className="font-mono text-[10px] opacity-80 break-all">{result.message}</p>
                {result.message === "outside_message_window" && (
                  <p className="text-[10px] opacity-70 mt-1">{t("channels.ig.test.outsideWindowHint", lang)}</p>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={sendMut.isPending}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors disabled:opacity-50"
            >
              {t("common.cancel", lang)}
            </button>
            <button
              type="submit"
              disabled={sendMut.isPending || !psid.trim()}
              className="text-xs px-4 py-1.5 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-medium flex items-center gap-1.5 disabled:opacity-50"
            >
              {sendMut.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("channels.ig.test.sending", lang)}</>
                : <><Send className="h-3.5 w-3.5" /> {t("channels.ig.test.send", lang)}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
