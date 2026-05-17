"use client";

/**
 * PendingInvitationsStrip — owner-facing "you have N pending invitations" strip
 * on the Masters tab. Reads salon.listMasterInvitations (pending only) and
 * surfaces each row with a Revoke action.
 *
 * Hidden when there are no pending invitations so the tab stays clean.
 * Updates automatically because InviteByEmailModal invalidates
 * `salon.listMasterInvitations` on success.
 */

import { Mail, Clock, X } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";

interface Props {
  tenantId: string;
}

function fmtAge(epochSec: number, lang: Lang): string {
  const diff = Math.floor(Date.now() / 1000) - epochSec;
  if (diff < 60) {
    switch (lang) {
      case "ru": case "ua": return "только что";
      case "pl": return "przed chwilą";
      default: return "just now";
    }
  }
  const mins = Math.floor(diff / 60);
  if (mins < 60) {
    switch (lang) {
      case "ru": return `${mins} мин назад`;
      case "ua": return `${mins} хв тому`;
      case "pl": return `${mins} min temu`;
      default: return `${mins} min ago`;
    }
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    switch (lang) {
      case "ru": return `${hrs} ч назад`;
      case "ua": return `${hrs} год тому`;
      case "pl": return `${hrs} godz temu`;
      default: return `${hrs} h ago`;
    }
  }
  const days = Math.floor(hrs / 24);
  switch (lang) {
    case "ru": return `${days} дн назад`;
    case "ua": return `${days} дн тому`;
    case "pl": return `${days} dni temu`;
    default: return `${days} d ago`;
  }
}

export function PendingInvitationsStrip({ tenantId }: Props) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const pending = api.salon.listMasterInvitations.useQuery(
    { tenantId, status: "pending" },
    { refetchOnWindowFocus: false },
  );
  const revoke = api.salon.revokeMasterInvitation.useMutation({
    onSettled: () => {
      void utils.salon.listMasterInvitations.invalidate({ tenantId });
    },
  });

  if (!pending.data || pending.data.length === 0) return null;

  const labels = (() => {
    switch (lang) {
      case "ru": return {
        title: "Ожидают принятия",
        scenarioExisting: "у пользователя есть аккаунт",
        scenarioNew: "новый пользователь",
        revoke: "Отменить",
      };
      case "ua": return {
        title: "Очікують прийняття",
        scenarioExisting: "у користувача є акаунт",
        scenarioNew: "новий користувач",
        revoke: "Скасувати",
      };
      case "pl": return {
        title: "Oczekujące zaproszenia",
        scenarioExisting: "użytkownik ma konto",
        scenarioNew: "nowy użytkownik",
        revoke: "Anuluj",
      };
      default: return {
        title: "Awaiting acceptance",
        scenarioExisting: "user has an account",
        scenarioNew: "new user",
        revoke: "Revoke",
      };
    }
  })();

  return (
    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2 px-1">
        <Mail className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
          {labels.title} · {pending.data.length}
        </span>
      </div>
      <div className="space-y-1.5">
        {pending.data.map((inv) => (
          <div
            key={inv.id}
            className="flex items-center gap-3 rounded-xl bg-white/60 dark:bg-slate-900/40 px-3 py-2 text-sm"
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium text-slate-900 dark:text-white truncate">
                {inv.invitedName ? `${inv.invitedName} · ${inv.email}` : inv.email}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <Clock className="h-3 w-3" />
                <span>{fmtAge(inv.createdAt, lang)}</span>
                <span>·</span>
                <span>
                  {inv.scenario === "existing_user"
                    ? labels.scenarioExisting
                    : labels.scenarioNew}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => revoke.mutate({ tenantId, invitationId: inv.id })}
              disabled={revoke.isPending}
              className="h-8 px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-red-500/15 hover:text-red-500 text-slate-600 dark:text-slate-300 text-xs font-medium transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              <X className="h-3 w-3" />
              {labels.revoke}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
