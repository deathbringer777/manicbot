"use client";

/**
 * Salon-owner-facing master-pairing table inside Channels → Telegram.
 *
 * Lists every master in the tenant with their pairing state and exposes
 * two affordances per row:
 *
 *   - "Сгенерировать ссылку" → mints a fresh `master_pairing_codes` row
 *     via `salon.createMasterPairingCode` and copies the deep-link to
 *     the clipboard so the owner can paste it to the master over WA / IG /
 *     SMS / paper.
 *   - "Ввести вручную"      → opens a small dialog to type a chat_id
 *     directly. Useful when the master can't open the deep-link (e.g.
 *     they're on iOS and Telegram won't autodetect /start payload) or
 *     when the owner already knows the master's TG ID.
 *
 * Hidden masters: archived ones are shown dimmed with a tiny badge so
 * the owner sees a complete picture, but the action buttons are
 * disabled (matches `createMasterPairingCode` server-side rejection).
 */

import { useState } from "react";
import { Send, Loader2, Copy, Check, Unlink, AlertCircle } from "lucide-react";
import { api } from "~/trpc/react";

interface Props {
  tenantId: string;
}

function fmtExpiresIn(expiresAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = expiresAt - now;
  if (diff <= 0) return "истёк";
  const days = Math.floor(diff / 86400);
  if (days > 0) return `${days} дн.`;
  const hours = Math.floor(diff / 3600);
  if (hours > 0) return `${hours} ч.`;
  return `${Math.max(1, Math.floor(diff / 60))} мин.`;
}

export function SalonMasterPairingTable({ tenantId }: Props) {
  const utils = api.useUtils();
  const stateQ = api.salon.listMasterPairingStates.useQuery(
    { tenantId },
    { refetchInterval: 30_000 },
  );
  const [lastLinkFor, setLastLinkFor] = useState<number | null>(null);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [lastLinkExpiresAt, setLastLinkExpiresAt] = useState<number | null>(null);
  const [copiedFor, setCopiedFor] = useState<number | null>(null);
  const [editingFor, setEditingFor] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const mintMut = api.salon.createMasterPairingCode.useMutation({
    onSuccess: async (res, vars) => {
      setLastLinkFor(vars.masterChatId);
      setLastLink(res.deepLink);
      setLastLinkExpiresAt(res.expiresAt);
      try {
        await navigator.clipboard.writeText(res.deepLink);
        setCopiedFor(vars.masterChatId);
        setTimeout(() => setCopiedFor(null), 1500);
      } catch { /* clipboard not available — user copies from textarea */ }
      await utils.salon.listMasterPairingStates.invalidate({ tenantId });
    },
  });
  const setChatIdMut = api.salon.setMasterTelegramChatId.useMutation({
    onSuccess: async () => {
      setEditingFor(null);
      setEditValue("");
      setEditError(null);
      await utils.salon.listMasterPairingStates.invalidate({ tenantId });
    },
    onError: (err) => setEditError(err.message),
  });

  if (stateQ.isLoading) {
    return (
      <div className="glass-card rounded-2xl p-4 flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
      </div>
    );
  }
  if (!stateQ.data) return null;
  const { masters: rows, botUsername } = stateQ.data;

  if (rows.length === 0) {
    return (
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-slate-500" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Мастера в Telegram</h3>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          В салоне пока нет мастеров. Добавь их во вкладке «Мастера» — потом сможешь привязать каждого к Telegram-боту салона.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Send className="h-4 w-4 text-brand-500" />
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Мастера в Telegram</h3>
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Каждый мастер может работать через бота салона: получать уведомления о новых записях, видеть своё расписание и клиентов. Для этого привяжи его Telegram — через одноразовую ссылку или вручную, если знаешь его Telegram ID.
      </p>

      <div className="space-y-2">
        {rows.map((m) => {
          const isLinked = m.telegramChatId !== null;
          const isLegacyRealTg = !m.isSynthetic && !isLinked; // primary chat_id is already a real TG
          const showMintedLink = lastLinkFor === m.chatId && lastLink !== null;
          return (
            <div
              key={m.chatId}
              data-testid={`master-pair-row-${m.chatId}`}
              className={`rounded-xl border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-900/50 p-3 space-y-2 ${m.archived ? "opacity-50" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm font-medium text-slate-900 dark:text-white truncate">
                  {m.name ?? `#${m.chatId}`}
                </span>
                {m.archived && (
                  <span className="rounded-full bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-500">
                    archived
                  </span>
                )}
                {isLegacyRealTg && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                    TG: {m.chatId}
                  </span>
                )}
                {isLinked && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                    <Check className="h-3 w-3" />
                    TG: {m.telegramChatId}
                  </span>
                )}
                {!isLinked && !isLegacyRealTg && m.hasActiveCode && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                    pending {m.activeCodeExpiresAt ? fmtExpiresIn(m.activeCodeExpiresAt) : ""}
                  </span>
                )}
              </div>

              {/* Mint feedback */}
              {showMintedLink && (
                <div className="flex items-center gap-2 rounded-lg border border-brand-500/30 bg-brand-500/5 p-2">
                  <code className="flex-1 truncate text-[10px] text-brand-700 dark:text-brand-200">{lastLink}</code>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        if (lastLink) await navigator.clipboard.writeText(lastLink);
                        setCopiedFor(m.chatId);
                        setTimeout(() => setCopiedFor(null), 1500);
                      } catch { /* */ }
                    }}
                    className="rounded-md bg-brand-500/15 px-2 py-1 text-[10px] font-medium text-brand-700 dark:text-brand-200 hover:bg-brand-500/25"
                  >
                    {copiedFor === m.chatId ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </button>
                  {lastLinkExpiresAt && (
                    <span className="text-[10px] text-slate-500">{fmtExpiresIn(lastLinkExpiresAt)}</span>
                  )}
                </div>
              )}

              {/* Manual chat_id editor */}
              {editingFor === m.chatId && (
                <div className="space-y-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/40 p-2">
                  <label className="text-[10px] text-slate-500 dark:text-slate-400">Telegram chat_id мастера (целое число)</label>
                  <input
                    type="number"
                    value={editValue}
                    onChange={(e) => { setEditValue(e.target.value); setEditError(null); }}
                    placeholder="123456789"
                    className="w-full rounded-md bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-brand-500"
                  />
                  {editError && (
                    <p className="flex items-center gap-1 text-[10px] text-red-500">
                      <AlertCircle className="h-3 w-3" /> {editError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const n = Number(editValue);
                        if (!Number.isFinite(n) || n <= 0) {
                          setEditError("Введи положительное целое число");
                          return;
                        }
                        setChatIdMut.mutate({
                          tenantId,
                          masterChatId: m.chatId,
                          telegramChatId: n,
                        });
                      }}
                      disabled={setChatIdMut.isPending || !editValue}
                      className="rounded-md bg-brand-500 px-3 py-1 text-[10px] font-medium text-white hover:bg-brand-600 disabled:opacity-40"
                    >
                      {setChatIdMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Сохранить"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditingFor(null); setEditValue(""); setEditError(null); }}
                      className="rounded-md bg-slate-200 dark:bg-slate-700 px-3 py-1 text-[10px] font-medium text-slate-700 dark:text-slate-300"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}

              {/* Action row */}
              {!m.archived && editingFor !== m.chatId && (
                <div className="flex flex-wrap gap-2">
                  {!isLegacyRealTg && (
                    <button
                      type="button"
                      onClick={() => mintMut.mutate({ tenantId, masterChatId: m.chatId })}
                      disabled={mintMut.isPending}
                      data-testid={`mint-link-${m.chatId}`}
                      className="inline-flex items-center gap-1 rounded-md bg-brand-500/10 px-2 py-1 text-[10px] font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-500/20 disabled:opacity-40"
                    >
                      {mintMut.isPending && mintMut.variables?.masterChatId === m.chatId
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Send className="h-3 w-3" />}
                      {isLinked ? "Сменить" : "Сгенерировать ссылку"}
                    </button>
                  )}
                  {!isLegacyRealTg && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingFor(m.chatId);
                        setEditValue(m.telegramChatId ? String(m.telegramChatId) : "");
                      }}
                      className="rounded-md bg-slate-200/60 dark:bg-slate-700/60 px-2 py-1 text-[10px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                    >
                      Ввести вручную
                    </button>
                  )}
                  {isLinked && (
                    <button
                      type="button"
                      onClick={() => setChatIdMut.mutate({ tenantId, masterChatId: m.chatId, telegramChatId: null })}
                      disabled={setChatIdMut.isPending}
                      className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-600 dark:text-red-400 hover:bg-red-500/20 disabled:opacity-40"
                    >
                      <Unlink className="h-3 w-3" />
                      Отвязать
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!botUsername && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400">
          У салона ещё не подключён Telegram-бот — без него ссылки работать не будут.
        </p>
      )}
    </div>
  );
}
