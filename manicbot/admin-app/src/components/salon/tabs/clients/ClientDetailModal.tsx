"use client";

/**
 * ClientDetailModal — opened when a row in the Clients tab is clicked.
 *
 * Three tabs:
 *   * Profile  — full contact + notes + tags + dob; Edit / Delete / Block
 *   * History  — last 50 appointments via clients.get
 *   * Blocks   — masters who blocked this client + global-block toggle
 *
 * Edits route through `ClientFormModal`; delete + global block confirm
 * via inline confirm banner so we don't introduce a fifth nested modal.
 */

import { useState } from "react";
import { X, Edit2, Trash2, Ban, ShieldCheck, Phone, Mail, Send, Instagram, Cake } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { ClientFormModal, type InitialClient } from "./ClientFormModal";

interface Props {
  tenantId: string;
  chatId: number;
  onClose: () => void;
}

function fmtDate(unix: number | null | undefined, lang: string): string {
  if (!unix) return "—";
  const localeMap: Record<string, string> = { ru: "ru-RU", ua: "uk-UA", en: "en-GB", pl: "pl-PL" };
  return new Intl.DateTimeFormat(localeMap[lang] ?? "en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(unix * 1000));
}

export function ClientDetailModal({ tenantId, chatId, onClose }: Props) {
  const { lang } = useLang();
  const [tab, setTab] = useState<"profile" | "history" | "blocks">("profile");
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [blockReason, setBlockReason] = useState("");

  const detail = api.clients.get.useQuery({ tenantId, chatId });
  const utils = api.useUtils();

  const del = api.clients.delete.useMutation({
    onSuccess: () => {
      void utils.clients.list.invalidate({ tenantId });
      onClose();
    },
  });

  const setBlock = api.clients.setGlobalBlock.useMutation({
    onSuccess: () => {
      void utils.clients.get.invalidate({ tenantId, chatId });
      void utils.clients.list.invalidate({ tenantId });
      setConfirmBlock(false);
      setBlockReason("");
    },
  });

  if (detail.isLoading) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
        <div className="glass-card rounded-2xl p-8 text-slate-500 dark:text-white/60">
          {t("common.loading", lang) || "Loading…"}
        </div>
      </div>
    );
  }
  if (detail.isError || !detail.data) return null;

  const c = detail.data.client;
  const isBlocked = c.isBlockedGlobal === 1;

  return (
    <>
      <div
        className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
        onClick={onClose}
      >
        <div
          className="glass-card w-full max-w-xl overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-white/10 dark:bg-slate-900/95 sm:rounded-2xl sm:p-5"
          onClick={(e) => e.stopPropagation()}
          style={{ maxHeight: "92vh" }}
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-500/20 to-violet-500/20 text-base font-bold text-brand-400">
                {(c.name ?? "?").charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {c.name ?? `#${c.chatId}`}
                  </h2>
                  {isBlocked && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-400">
                      <Ban className="h-3 w-3" />
                      {t("clients.detail.blockedGlobally", lang)}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  {c.lifetimeVisits} {t("clients.detail.totalVisits", lang).toLowerCase()} ·
                  {" "}
                  {c.lastVisitAt ? fmtDate(c.lastVisitAt, lang) : t("clients.detail.never", lang)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 dark:bg-white/5 dark:text-white/60"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tab pills — horizontally scrollable to handle long locale
              labels (Ukrainian "Блокування") on narrow mobile. */}
          <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 scrollbar-none">
            {([
              ["profile", t("clients.detail.tabProfile", lang)],
              ["history", t("clients.detail.tabHistory", lang)],
              ["blocks", t("clients.detail.tabBlocks", lang)],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                data-testid={`cd-tab-${key}`}
                className={`shrink-0 rounded-xl px-3 py-2 text-xs font-medium transition ${
                  tab === key
                    ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                    : "text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "profile" && (
            <div className="space-y-3 text-sm">
              <ContactRow icon={<Phone className="h-4 w-4" />} value={c.phone} />
              <ContactRow icon={<Mail className="h-4 w-4" />} value={c.email} />
              <ContactRow icon={<Send className="h-4 w-4 text-sky-500" />} value={c.tgUsername ? `@${c.tgUsername}` : null} />
              <ContactRow icon={<Instagram className="h-4 w-4 text-pink-500" />} value={c.igUsername ? `@${c.igUsername}` : null} />
              <ContactRow icon={<Cake className="h-4 w-4 text-amber-500" />} value={c.dob ?? null} />
              {c.tags && (
                <div className="flex flex-wrap gap-1">
                  {c.tags.split(",").map((tag) => (
                    <span key={tag} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
                      {tag.trim()}
                    </span>
                  ))}
                </div>
              )}
              {c.notes && (
                <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
                  {c.notes}
                </div>
              )}

              {/* Action row — each button is flex-1 on mobile (touch-friendly,
                  equal width) and shrinks to natural width on tablet+. */}
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-white/5">
                <button
                  onClick={() => setEditOpen(true)}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5 sm:flex-initial"
                  data-testid="cd-edit"
                >
                  <Edit2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t("clients.action.edit", lang)}</span>
                </button>
                {!isBlocked ? (
                  <button
                    onClick={() => setConfirmBlock(true)}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-600 dark:text-amber-400 sm:flex-initial"
                    data-testid="cd-block"
                  >
                    <Ban className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t("clients.action.blockGlobal", lang)}</span>
                  </button>
                ) : (
                  <button
                    onClick={() => setBlock.mutate({ tenantId, chatId, blocked: false })}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 sm:flex-initial"
                    data-testid="cd-unblock"
                  >
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t("clients.action.unblockGlobal", lang)}</span>
                  </button>
                )}
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 sm:ml-auto sm:flex-initial"
                  data-testid="cd-delete"
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t("clients.action.delete", lang)}</span>
                </button>
              </div>

              {/* Inline confirm banners */}
              {confirmDelete && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-300">
                  <p className="mb-2">{t("clients.delete.confirm", lang)}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="flex-1 rounded bg-white px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    >
                      {t("common.cancel", lang)}
                    </button>
                    <button
                      onClick={() => del.mutate({ tenantId, chatId })}
                      disabled={del.isPending}
                      className="flex-1 rounded bg-rose-600 px-2 py-1 font-semibold text-white"
                    >
                      {t("clients.action.delete", lang)}
                    </button>
                  </div>
                </div>
              )}

              {confirmBlock && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                  <p className="mb-2">{t("clients.block.confirm", lang)}</p>
                  <input
                    type="text"
                    placeholder={t("clients.block.reasonPh", lang)}
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value)}
                    maxLength={500}
                    className="mb-2 w-full rounded border border-amber-500/30 bg-white px-2 py-1 text-xs dark:bg-slate-800 dark:text-slate-300"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setConfirmBlock(false); setBlockReason(""); }}
                      className="flex-1 rounded bg-white px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    >
                      {t("common.cancel", lang)}
                    </button>
                    <button
                      onClick={() => setBlock.mutate({ tenantId, chatId, blocked: true, reason: blockReason.trim() || undefined })}
                      disabled={setBlock.isPending}
                      className="flex-1 rounded bg-amber-600 px-2 py-1 font-semibold text-white"
                    >
                      {t("clients.action.blockGlobal", lang)}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "history" && (
            <div className="space-y-2 text-sm">
              {detail.data.history.length === 0 && (
                <p className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500 dark:bg-white/[0.04]">
                  {t("clients.detail.noHistory", lang)}
                </p>
              )}
              {detail.data.history.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-2.5 text-xs dark:bg-white/[0.04]">
                  <div>
                    <p className="font-medium text-slate-800 dark:text-slate-200">
                      {a.date} · {a.time}
                    </p>
                    <p className="text-slate-500">
                      {a.svcId} · master #{a.masterId ?? "—"}
                    </p>
                  </div>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${
                      a.cancelled
                        ? "bg-rose-500/15 text-rose-400"
                        : a.noShow
                          ? "bg-orange-500/15 text-orange-400"
                          : a.status === "done"
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-slate-500/15 text-slate-400"
                    }`}
                  >
                    {a.cancelled ? "cancelled" : a.noShow ? "no-show" : a.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {tab === "blocks" && (
            <div className="space-y-2 text-sm">
              {detail.data.blocks.length === 0 ? (
                <p className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500 dark:bg-white/[0.04]">
                  {t("clients.detail.noBlocks", lang)}
                </p>
              ) : (
                detail.data.blocks.map((b: any) => (
                  <div key={b.id} className="rounded-lg bg-slate-50 p-2.5 text-xs dark:bg-white/[0.04]">
                    <p className="font-medium text-slate-800 dark:text-slate-200">
                      {b.masterName ?? `master #${b.masterChatId}`}
                    </p>
                    {b.reason && <p className="mt-1 text-slate-500">{b.reason}</p>}
                    <p className="mt-1 text-[10px] text-slate-400">
                      {fmtDate(b.blockedAt, lang)}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {editOpen && (
        <ClientFormModal
          tenantId={tenantId}
          initial={{
            chatId: c.chatId,
            name: c.name,
            phone: c.phone,
            email: c.email,
            tgUsername: c.tgUsername,
            igUsername: c.igUsername,
            tags: c.tags,
            notes: c.notes,
            dob: c.dob,
          } satisfies InitialClient}
          onClose={() => setEditOpen(false)}
          onSaved={() => setEditOpen(false)}
        />
      )}
    </>
  );
}

function ContactRow({ icon, value }: { icon: React.ReactNode; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
      <span className="text-slate-400">{icon}</span>
      <span className="truncate">{value}</span>
    </div>
  );
}
