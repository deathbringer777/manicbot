"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  X,
  User as DmIcon,
  Users as GroupIcon,
  Check,
  UserPlus,
  Send as TelegramIcon,
  MailWarning,
} from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

type Mode = "pick" | "dm" | "group";

interface Props {
  tenantId: string;
  onClose: () => void;
  onCreated: (threadId: string) => void;
}

/**
 * Fallback empty state — only triggered when the salon literally has zero
 * masters (no DM-able peers AND no placeholders AND no pending invites).
 * Surfaces the path back to the Team tab so the owner can invite somebody.
 */
function EmptyStaffHint({ onClose }: { onClose: () => void }) {
  const { lang } = useLang();
  return (
    <div className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center dark:border-slate-700">
      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
        {t("messenger.newThread.noTeam", lang)}
      </p>
      <p className="mt-1 text-[11px] text-slate-500">
        {t("messenger.newThread.noTeamHint", lang)}
      </p>
      <Link
        href="/settings?section=team"
        onClick={onClose}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-brand-600"
      >
        <UserPlus className="h-3 w-3" />
        {t("messenger.newThread.goToTeam", lang)}
      </Link>
    </div>
  );
}

export function NewThreadModal({ tenantId, onClose, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>("pick");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupTitle, setGroupTitle] = useState("");
  const { lang } = useLang();

  const staffQ = api.messenger.listStaff.useQuery({ tenantId }, { enabled: !!tenantId });
  const allCandidates = useMemo(() => staffQ.data?.candidates ?? [], [staffQ.data]);
  const pendingInviteCount = staffQ.data?.pendingInviteCount ?? 0;
  const utils = api.useUtils();

  // Group split: web_user (canDm=true) first; master placeholders (canDm=false) below.
  const { dmable, placeholders } = useMemo(() => {
    const dm: typeof allCandidates = [];
    const ph: typeof allCandidates = [];
    for (const c of allCandidates) {
      (c.canDm ? dm : ph).push(c);
    }
    return { dmable: dm, placeholders: ph };
  }, [allCandidates]);

  // Only DM-able rows can be added to a group chat (a group requires every
  // member to be reachable in-app).
  const groupCandidates = dmable;

  const dmMutation = api.messenger.createStaffDm.useMutation({
    onSuccess: async ({ threadId }) => {
      await utils.messenger.listThreads.invalidate({ tenantId });
      onCreated(threadId);
    },
  });

  const groupMutation = api.messenger.createStaffGroup.useMutation({
    onSuccess: async ({ threadId }) => {
      await utils.messenger.listThreads.invalidate({ tenantId });
      onCreated(threadId);
    },
  });

  const isBusy = dmMutation.isPending || groupMutation.isPending;

  function openDmWithCandidate(c: (typeof allCandidates)[number]): void {
    if (c.refKind === "web_user") {
      dmMutation.mutate({ tenantId, otherWebUserId: c.id });
    } else {
      // Placeholder: opens a thread that auto-promotes the moment the master
      // creates / links a web account (see linkMasterPlaceholderToWebUser).
      dmMutation.mutate({ tenantId, otherMasterChatId: c.masterChatId! });
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-md"
      onClick={onClose}
      data-testid="new-thread-modal"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-thread-modal-title"
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h3
            id="new-thread-modal-title"
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            {mode === "pick"
              ? t("messenger.newThread.title", lang)
              : mode === "dm"
                ? t("messenger.newThread.dm", lang)
                : t("messenger.newThread.group", lang)}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            aria-label={t("messenger.newThread.close", lang)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode === "pick" && (
          <div className="space-y-2 p-4">
            <button
              type="button"
              onClick={() => setMode("dm")}
              data-testid="pick-dm"
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/15 text-blue-500">
                <DmIcon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t("messenger.newThread.dm", lang)}
                </p>
                <p className="text-[11px] text-slate-500">
                  {t("messenger.newThread.dmHint", lang)}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setMode("group")}
              data-testid="pick-group"
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/15 text-purple-500">
                <GroupIcon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t("messenger.newThread.group", lang)}
                </p>
                <p className="text-[11px] text-slate-500">
                  {t("messenger.newThread.groupHint", lang)}
                </p>
              </div>
            </button>
          </div>
        )}

        {mode === "dm" && (
          <div className="p-4">
            <p className="mb-2 text-xs text-slate-500">
              {t("messenger.newThread.pickStaff", lang)}
            </p>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {staffQ.isLoading ? (
                <div className="space-y-1">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
                  ))}
                </div>
              ) : allCandidates.length === 0 && pendingInviteCount === 0 ? (
                <EmptyStaffHint onClose={onClose} />
              ) : (
                <>
                  {/* — DM-able rows ───────────────────────────────────── */}
                  {dmable.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => openDmWithCandidate(u)}
                      disabled={isBusy}
                      data-testid={`dm-target-${u.id}`}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-800"
                    >
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-500/20 text-[11px] font-bold text-brand-500">
                        {(u.name ?? "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-slate-900 dark:text-slate-100">{u.name}</p>
                        <p className="truncate text-[10px] text-slate-500">{u.role}</p>
                      </div>
                    </button>
                  ))}

                  {/* — Placeholder rows (no web account) ─────────────── */}
                  {placeholders.length > 0 && (
                    <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                      <p className="mb-1 px-2 text-[10px] uppercase tracking-wider text-slate-400">
                        {t("messenger.newThread.noWebAccount", lang)}
                      </p>
                      {placeholders.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => openDmWithCandidate(u)}
                          disabled={isBusy}
                          data-testid={`dm-target-${u.id}`}
                          title={t("messenger.newThread.placeholderHint", lang)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-800"
                        >
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-[11px] font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                            {(u.name ?? "?").charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-slate-900 dark:text-slate-100">
                              {u.name}
                            </p>
                            <div className="flex items-center gap-1">
                              <TelegramIcon className="h-2.5 w-2.5 text-slate-400" />
                              <p className="truncate text-[10px] text-slate-500">
                                {t("messenger.newThread.telegramOnly", lang)}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* — Pending invitations hint ──────────────────────── */}
                  {pendingInviteCount > 0 && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 dark:border-amber-900/40 dark:bg-amber-950/20">
                      <MailWarning className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                      <div className="flex-1">
                        <p className="text-[11px] font-medium text-amber-800 dark:text-amber-200">
                          {pendingInviteCount === 1
                            ? `1 ${t("messenger.newThread.pendingHint", lang)}`
                            : `${pendingInviteCount} ${t("messenger.newThread.pendingHint", lang)}`}
                        </p>
                        <p className="mt-0.5 text-[10px] text-amber-700/80 dark:text-amber-300/70">
                          {t("messenger.newThread.pendingHint", lang)}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            {dmMutation.error && (
              <p className="mt-2 text-[11px] text-red-500">{dmMutation.error.message}</p>
            )}
            <button
              type="button"
              onClick={() => setMode("pick")}
              className="mt-3 text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              {t("messenger.newThread.back", lang)}
            </button>
          </div>
        )}

        {mode === "group" && (
          <div className="p-4">
            <input
              type="text"
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder={t("messenger.newThread.groupName", lang)}
              maxLength={120}
              data-testid="group-title-input"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />

            <p className="mb-2 mt-3 text-xs text-slate-500">
              {t("messenger.newThread.members", lang)}
            </p>
            <div className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800">
              {groupCandidates.length ? (
                groupCandidates.map((u) => {
                  const selected = selectedIds.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() =>
                        setSelectedIds((ids) =>
                          ids.includes(u.id) ? ids.filter((x) => x !== u.id) : [...ids, u.id],
                        )
                      }
                      data-testid={`group-member-${u.id}`}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                        selected
                          ? "bg-brand-500/15 text-brand-700 dark:text-brand-300"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800"
                      }`}
                    >
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500/20 text-[10px] font-bold text-brand-500">
                        {(u.name ?? "?").charAt(0).toUpperCase()}
                      </div>
                      <span className="flex-1 truncate text-xs">{u.name}</span>
                      {selected && <Check className="h-3 w-3 text-brand-500" />}
                    </button>
                  );
                })
              ) : (
                <EmptyStaffHint onClose={onClose} />
              )}
            </div>

            {placeholders.length > 0 && (
              <p className="mt-2 text-[10px] text-slate-500">
                {t("messenger.newThread.placeholderHint", lang)}
              </p>
            )}

            {groupMutation.error && (
              <p className="mt-2 text-[11px] text-red-500">{groupMutation.error.message}</p>
            )}

            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMode("pick")}
                className="text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                {t("messenger.newThread.back", lang)}
              </button>
              <button
                type="button"
                onClick={() =>
                  groupMutation.mutate({
                    tenantId,
                    title: groupTitle.trim(),
                    memberWebUserIds: selectedIds,
                  })
                }
                disabled={!groupTitle.trim() || selectedIds.length === 0 || isBusy}
                data-testid="group-create-button"
                className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-40"
              >
                {t("messenger.newThread.create", lang)}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
