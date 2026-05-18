"use client";

/**
 * MasterTelegramInlineSection — per-master Telegram pairing controls inside
 * `MasterDetailModal` (Masters tab → click row).
 *
 * Mirrors the per-row logic of `SalonMasterPairingTable` (Channels →
 * Telegram tab) but scoped to a single master so the salon owner can pair
 * / unpair / mint a fresh deep-link / paste a Telegram ID directly from
 * the natural "edit this master" flow — no tab-hopping required.
 *
 * Render rules:
 *   - self_registered → not rendered (the master owns their own pairing
 *     via the Master dashboard Profile tab).
 *   - legacy real-TG master (origin='invited_telegram', not synthetic,
 *     no separate telegram_chat_id) → informational badge only, no
 *     mint/unpair buttons (their primary chat_id IS already a Telegram).
 *   - archived → dimmed + read-only.
 *   - bot not connected → amber warning, all actions disabled.
 *
 * Reuses the existing tRPC surface:
 *   - salon.getMasterPairingState  (new — single-master variant)
 *   - salon.createMasterPairingCode
 *   - salon.setMasterTelegramChatId
 */

import { useState } from "react";
import { Send, Loader2, Copy, Check, Unlink, AlertCircle, Pencil, ChevronRight } from "lucide-react";
import { api } from "~/trpc/react";
import { t, type Lang } from "~/lib/i18n";

interface Props {
  tenantId: string;
  masterChatId: number;
  /** master.origin from getMasterDetail. Self-registered hides the whole section. */
  origin: string | null;
  lang: Lang;
  /**
   * Optional click handler for the "bot not connected" amber banner. Owners
   * land on this section without realising the salon has no Telegram bot
   * yet — wiring a callback here lets the parent close the modal and jump
   * straight to the Channels → Telegram sub-tab (Telegram is the default
   * `SalonChannelsTab` sub-tab, so `tab=channels` lands exactly there).
   * If omitted, the banner renders as plain text.
   */
  onNavigateToChannels?: () => void;
}

function fmtExpiresIn(expiresAt: number, lang: Lang): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = expiresAt - now;
  if (diff <= 0) return t("masterDetail.pair.expired", lang);
  const days = Math.floor(diff / 86400);
  if (days > 0) return t("masterDetail.pair.daysShort", lang).replace("{n}", String(days));
  const hours = Math.floor(diff / 3600);
  if (hours > 0) return t("masterDetail.pair.hoursShort", lang).replace("{n}", String(hours));
  return t("masterDetail.pair.minutesShort", lang).replace("{n}", String(Math.max(1, Math.floor(diff / 60))));
}

export function MasterTelegramInlineSection({ tenantId, masterChatId, origin, lang, onNavigateToChannels }: Props) {
  const utils = api.useUtils();
  const stateQ = api.salon.getMasterPairingState.useQuery(
    { tenantId, masterChatId },
    { refetchOnWindowFocus: false },
  );

  const [lastLink, setLastLink] = useState<string | null>(null);
  const [lastLinkExpiresAt, setLastLinkExpiresAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmUnpair, setConfirmUnpair] = useState(false);

  const mintMut = api.salon.createMasterPairingCode.useMutation({
    onSuccess: async (res) => {
      setLastLink(res.deepLink);
      setLastLinkExpiresAt(res.expiresAt);
      try {
        await navigator.clipboard.writeText(res.deepLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch { /* clipboard not available in this context — user copies manually */ }
      await utils.salon.getMasterPairingState.invalidate({ tenantId, masterChatId });
    },
  });

  const setChatIdMut = api.salon.setMasterTelegramChatId.useMutation({
    onSuccess: async () => {
      setEditing(false);
      setEditValue("");
      setEditError(null);
      setConfirmUnpair(false);
      await utils.salon.getMasterPairingState.invalidate({ tenantId, masterChatId });
    },
    onError: (err) => setEditError(err.message),
  });

  // self_registered masters are excluded by design — the master owns this surface.
  if (origin === "self_registered") return null;

  if (stateQ.isLoading) {
    return (
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>{t("masterDetail.pair.loading", lang)}</span>
        </div>
      </div>
    );
  }

  if (!stateQ.data) return null;
  const s = stateQ.data;

  // Legacy real-TG: their primary chat_id IS their Telegram identity, so
  // they don't need (and can't use) the synthetic→real pairing flow.
  const isLegacyRealTg = !s.isSynthetic && s.telegramChatId === null && origin === "invited_telegram";
  const isLinked = s.telegramChatId !== null;
  const isMintPending = mintMut.isPending;
  const isSavePending = setChatIdMut.isPending;
  const actionsDisabled = s.archived || !s.botUsername;

  return (
    <div
      data-testid="master-pair-section"
      className={`mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2 dark:border-white/10 dark:bg-white/[0.03] ${s.archived ? "opacity-60" : ""}`}
    >
      {/* Header: icon + title + status badge */}
      <div className="flex items-center gap-2">
        <Send className="h-4 w-4 shrink-0 text-sky-500" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
          {t("masterDetail.pair.title", lang)}
        </h3>
        <div className="ml-auto">
          {isLegacyRealTg && (
            <span
              data-testid="master-pair-badge-legacy"
              className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
            >
              {t("masterDetail.pair.legacyTg", lang).replace("{chatId}", String(s.chatId))}
            </span>
          )}
          {isLinked && (
            <span
              data-testid="master-pair-badge-linked"
              className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
            >
              <Check className="h-3 w-3" />
              {t("masterDetail.pair.linkedBadge", lang).replace("{chatId}", String(s.telegramChatId))}
            </span>
          )}
          {!isLinked && !isLegacyRealTg && s.hasActiveCode && (
            <span
              data-testid="master-pair-badge-pending"
              className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
            >
              {t("masterDetail.pair.pendingBadge", lang)}{" "}
              {s.activeCodeExpiresAt ? fmtExpiresIn(s.activeCodeExpiresAt, lang) : ""}
            </span>
          )}
          {!isLinked && !isLegacyRealTg && !s.hasActiveCode && (
            <span
              data-testid="master-pair-badge-notpaired"
              className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-400"
            >
              {t("masterDetail.pair.notPairedBadge", lang)}
            </span>
          )}
        </div>
      </div>

      {/* Helper / context copy */}
      {isLegacyRealTg ? (
        <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
          {t("masterDetail.pair.helperLegacy", lang)}
        </p>
      ) : !isLinked ? (
        <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
          {t("masterDetail.pair.helper", lang)}
        </p>
      ) : null}

      {!s.botUsername && (
        onNavigateToChannels ? (
          <button
            type="button"
            onClick={onNavigateToChannels}
            data-testid="master-pair-bot-missing-cta"
            className="flex w-full items-center gap-1 rounded-md text-left text-[10px] text-amber-600 underline-offset-2 transition hover:text-amber-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 dark:text-amber-400 dark:hover:text-amber-300"
          >
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span className="flex-1">{t("masterDetail.pair.botMissing", lang)}</span>
            <ChevronRight className="h-3 w-3 shrink-0" />
          </button>
        ) : (
          <p className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
            <AlertCircle className="h-3 w-3" />
            {t("masterDetail.pair.botMissing", lang)}
          </p>
        )
      )}

      {/* Just-minted deep link card */}
      {lastLink && (
        <div
          data-testid="master-pair-minted"
          className="flex items-center gap-2 rounded-lg border border-brand-500/30 bg-brand-500/5 p-2"
        >
          <code className="flex-1 truncate text-[10px] text-brand-700 dark:text-brand-200">{lastLink}</code>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(lastLink);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch { /* */ }
            }}
            className="rounded-md bg-brand-500/15 px-2 py-1 text-[10px] font-medium text-brand-700 dark:text-brand-200 hover:bg-brand-500/25"
            data-testid="master-pair-copy"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
          {lastLinkExpiresAt && (
            <span className="text-[10px] text-slate-500">{fmtExpiresIn(lastLinkExpiresAt, lang)}</span>
          )}
        </div>
      )}

      {/* Manual chat_id editor */}
      {editing && (
        <div className="space-y-2 rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-800/50">
          <label className="block text-[10px] text-slate-500 dark:text-slate-400">
            {t("masterDetail.pair.manualLabel", lang)}
          </label>
          <input
            type="number"
            value={editValue}
            onChange={(e) => {
              setEditValue(e.target.value);
              setEditError(null);
            }}
            placeholder="123456789"
            data-testid="master-pair-manual-input"
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-brand-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
          />
          {editError && (
            <p className="flex items-center gap-1 text-[10px] text-red-500">
              <AlertCircle className="h-3 w-3" />
              {editError}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                const n = Number(editValue);
                if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
                  setEditError(t("masterDetail.pair.errorInvalidChatId", lang));
                  return;
                }
                setChatIdMut.mutate({ tenantId, masterChatId, telegramChatId: n });
              }}
              disabled={isSavePending || !editValue}
              data-testid="master-pair-manual-save"
              className="rounded-md bg-brand-500 px-3 py-1 text-[10px] font-medium text-white hover:bg-brand-600 disabled:opacity-40"
            >
              {isSavePending ? <Loader2 className="h-3 w-3 animate-spin" /> : t("common.save", lang)}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setEditValue("");
                setEditError(null);
              }}
              className="rounded-md bg-slate-200 px-3 py-1 text-[10px] font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-300"
            >
              {t("common.cancel", lang)}
            </button>
          </div>
        </div>
      )}

      {/* Inline unpair confirmation */}
      {confirmUnpair && (
        <div
          data-testid="master-pair-unpair-confirm"
          className="space-y-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-[10px] text-rose-700 dark:text-rose-300"
        >
          <p>{t("masterDetail.pair.unpairConfirm", lang)}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmUnpair(false)}
              className="rounded bg-white px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >
              {t("common.cancel", lang)}
            </button>
            <button
              type="button"
              onClick={() => setChatIdMut.mutate({ tenantId, masterChatId, telegramChatId: null })}
              disabled={isSavePending}
              data-testid="master-pair-unpair-confirmed"
              className="rounded bg-rose-600 px-2 py-1 font-semibold text-white disabled:opacity-50"
            >
              {t("masterDetail.pair.unpair", lang)}
            </button>
          </div>
        </div>
      )}

      {/* Action buttons (hidden during editing / confirm flows / archived / legacy real-TG) */}
      {!s.archived && !isLegacyRealTg && !editing && !confirmUnpair && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => mintMut.mutate({ tenantId, masterChatId })}
            disabled={isMintPending || actionsDisabled}
            data-testid="master-pair-mint"
            className="inline-flex items-center gap-1 rounded-md bg-brand-500/10 px-2.5 py-1.5 text-[11px] font-medium text-brand-700 hover:bg-brand-500/20 disabled:opacity-40 dark:text-brand-300"
          >
            {isMintPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            {isLinked || s.hasActiveCode
              ? t("masterDetail.pair.mintAgainCta", lang)
              : t("masterDetail.pair.mintCta", lang)}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setEditValue(s.telegramChatId ? String(s.telegramChatId) : "");
            }}
            disabled={actionsDisabled}
            data-testid="master-pair-manual-toggle"
            className="inline-flex items-center gap-1 rounded-md bg-slate-200/60 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-40 dark:bg-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <Pencil className="h-3 w-3" />
            {t("masterDetail.pair.manualEntry", lang)}
          </button>
          {isLinked && (
            <button
              type="button"
              onClick={() => setConfirmUnpair(true)}
              disabled={isSavePending}
              data-testid="master-pair-unpair"
              className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-medium text-rose-600 hover:bg-rose-500/20 disabled:opacity-40 dark:text-rose-400"
            >
              <Unlink className="h-3 w-3" />
              {t("masterDetail.pair.unpair", lang)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
