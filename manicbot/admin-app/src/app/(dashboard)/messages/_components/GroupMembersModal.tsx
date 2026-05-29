"use client";

/**
 * Members panel for a staff_group thread (migration 0093).
 *
 * Renders the participant list and, for the salon owner, a ✕ button beside
 * each non-owner member. Clicking ✕ calls `messenger.removeStaffMember`
 * which:
 *   1. drops the row from `thread_members`,
 *   2. writes a "removed by owner" system message into the thread.
 *
 * Owner-only affordance is enforced both at the backend (mutation refuses
 * non-owners with FORBIDDEN) and at the UI (the ✕ doesn't render for
 * non-owner viewers). Removing a member with role='owner' is refused —
 * the salon owner can't lock themselves out of the default "Команда" group.
 */

import { useState } from "react";
import { X, Loader2, UserMinus } from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

interface Props {
  tenantId: string;
  threadId: string;
  onClose: () => void;
}

export function GroupMembersModal({ tenantId, threadId, onClose }: Props) {
  const { role } = useRole();
  const { lang } = useLang();
  const isOwner = role === "tenant_owner" || role === "system_admin";
  const utils = api.useUtils();

  const membersQ = api.messenger.listStaffGroupMembers.useQuery(
    { tenantId, threadId },
    { refetchOnWindowFocus: false },
  );

  const [pendingRef, setPendingRef] = useState<string | null>(null);
  const removeMutation = api.messenger.removeStaffMember.useMutation({
    onSuccess: async () => {
      setPendingRef(null);
      await Promise.all([
        utils.messenger.listStaffGroupMembers.invalidate({ tenantId, threadId }),
        utils.messenger.getThread.invalidate({ tenantId, threadId }),
        utils.messenger.listThreads.invalidate({ tenantId }),
      ]);
    },
    onError: () => setPendingRef(null),
  });

  function handleRemove(memberKind: "web_user" | "master", memberRef: string) {
    setPendingRef(memberRef);
    removeMutation.mutate({ tenantId, threadId, memberKind, memberRef });
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md"
      onClick={onClose}
      data-testid="group-members-modal"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-members-modal-title"
        className="w-full max-w-sm overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900 dark:ring-white/5"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "85vh" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2
            id="group-members-modal-title"
            className="text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            {t("messenger.members.title", lang)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 dark:bg-white/5 dark:text-white/60"
            aria-label={t("common.close", lang)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {membersQ.isLoading && (
          <div className="flex items-center justify-center py-6 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {membersQ.data && membersQ.data.length === 0 && (
          <p className="py-6 text-center text-xs text-slate-500">
            {t("messenger.members.empty", lang)}
          </p>
        )}

        {membersQ.data && (
          <ul className="space-y-1.5">
            {membersQ.data.map((m) => {
              const key = `${m.memberKind}:${m.memberRef}`;
              const canRemove =
                isOwner &&
                m.role !== "owner" &&
                (m.memberKind === "web_user" || m.memberKind === "master");
              const isPending = pendingRef === m.memberRef && removeMutation.isPending;

              const roleLabel =
                m.role === "owner"
                  ? t("messenger.role.owner", lang)
                  : m.connectStatus === "telegram_only"
                    ? t("messenger.role.telegram", lang)
                    : m.connectStatus === "external"
                      ? t("messenger.role.external", lang)
                      : t("messenger.role.member", lang);

              return (
                <li
                  key={key}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:border-white/5 dark:bg-white/[0.04]"
                  data-testid={`group-member-${m.memberKind}-${m.memberRef}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-900 dark:text-slate-100">
                      {m.name}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">
                      {roleLabel}
                    </p>
                  </div>
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() =>
                        handleRemove(
                          m.memberKind as "web_user" | "master",
                          m.memberRef,
                        )
                      }
                      disabled={isPending}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-600 transition hover:bg-rose-500/20 disabled:opacity-50 dark:text-rose-400"
                      data-testid={`group-member-remove-${m.memberRef}`}
                      title={t("messenger.removeFromGroup", lang)}
                      aria-label={t("messenger.removeFromGroup", lang)}
                    >
                      {isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <UserMinus className="h-3 w-3" />
                      )}
                      <span>{t("messenger.remove", lang)}</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {removeMutation.error && (
          <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-[11px] text-rose-600 dark:text-rose-300">
            {removeMutation.error.message}
          </div>
        )}
      </div>
    </div>
  );
}
