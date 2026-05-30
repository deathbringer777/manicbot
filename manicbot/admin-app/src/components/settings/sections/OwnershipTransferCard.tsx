"use client";

import { useState } from "react";
import { Loader2, UserRound, ShieldCheck, ArrowRightLeft, X, AlertCircle, Mail, Crown } from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";
import { Btn } from "~/components/salon/SalonShared";
import { CollapsibleSection } from "~/components/settings/CollapsibleSection";

const OWNERSHIP_TRANSFER_L: Record<Lang, {
  transferTitle: string;
  transferDesc: string;
  transferBtn: string;
  transferPending: string;
  pendingTo: string;
  cancelTransfer: string;
  confirmTitle: string;
  confirmHint: string;
  send: string;
  safety1: string;
  safety2: string;
  safety3: string;
  notReady: string;
  noCandidates: string;
}> = {
  ru: {
    transferTitle: "Передача прав владения",
    transferDesc: "Передать роль владельца другому участнику команды. Потребуется подтверждение через email.",
    transferBtn: "Передать права",
    transferPending: "Передача в процессе. Проверьте email для подтверждения.",
    pendingTo: "Получатель",
    cancelTransfer: "Отменить",
    confirmTitle: "Кому передать права?",
    confirmHint: "После передачи вы станете мастером, а выбранный участник — владельцем.",
    send: "Отправить запрос",
    safety1: "Запрос действителен 24 часа",
    safety2: "Подтверждение придёт на ваш email",
    safety3: "До подтверждения изменений не произойдёт",
    notReady: "Активный план обязателен",
    noCandidates: "Пока некому передать права. Передавать можно только мастерам, у которых есть веб-аккаунт (вход по email).",
  },
  ua: {
    transferTitle: "Передача прав власника",
    transferDesc: "Передати роль власника іншому учаснику команди. Знадобиться підтвердження через email.",
    transferBtn: "Передати права",
    transferPending: "Передача в процесі. Перевірте email для підтвердження.",
    pendingTo: "Отримувач",
    cancelTransfer: "Скасувати",
    confirmTitle: "Кому передати права?",
    confirmHint: "Після передачі ви станете майстром, а обраний учасник — власником.",
    send: "Надіслати запит",
    safety1: "Запит дійсний 24 години",
    safety2: "Підтвердження прийде на ваш email",
    safety3: "До підтвердження змін не буде",
    notReady: "Активний план обовʼязковий",
    noCandidates: "Поки нікому передати права. Передавати можна лише майстрам, у яких є веб-акаунт (вхід через email).",
  },
  en: {
    transferTitle: "Transfer ownership",
    transferDesc: "Transfer the owner role to another team member. Requires email confirmation.",
    transferBtn: "Transfer ownership",
    transferPending: "Transfer in progress. Check your email to confirm.",
    pendingTo: "Recipient",
    cancelTransfer: "Cancel",
    confirmTitle: "Transfer ownership to whom?",
    confirmHint: "After the transfer you become a master, and the selected member becomes the owner.",
    send: "Send request",
    safety1: "Request valid for 24 hours",
    safety2: "Confirmation will be sent to your email",
    safety3: "Nothing changes until you confirm",
    notReady: "Active subscription required",
    noCandidates: "No one to transfer to yet. Ownership can only go to masters who have a web account (email login).",
  },
  pl: {
    transferTitle: "Przekazanie własności",
    transferDesc: "Przekaż rolę właściciela innemu członkowi zespołu. Wymaga potwierdzenia przez email.",
    transferBtn: "Przekaż własność",
    transferPending: "Przekazanie w toku. Sprawdź email, aby potwierdzić.",
    pendingTo: "Odbiorca",
    cancelTransfer: "Anuluj",
    confirmTitle: "Komu przekazać własność?",
    confirmHint: "Po przekazaniu zostaniesz mistrzem, a wybrany członek — właścicielem.",
    send: "Wyślij prośbę",
    safety1: "Prośba ważna 24 godziny",
    safety2: "Potwierdzenie zostanie wysłane na Twój email",
    safety3: "Nic się nie zmieni dopóki nie potwierdzisz",
    notReady: "Wymagana aktywna subskrypcja",
    noCandidates: "Nie ma jeszcze nikogo, komu można przekazać własność. Przekazanie jest możliwe tylko mistrzom posiadającym konto webowe (logowanie email).",
  },
} as const;

/**
 * Owner-only ownership-transfer control, rendered as a "danger zone" item on the
 * Account tab. Self-contained: owns its picker state, the owner-scoped queries
 * (gated by `enabled` so a master/manager visiting Account never fires them),
 * and the request/cancel mutations. Renders nothing for non-owners.
 */
export function OwnershipTransferCard() {
  const { tenantId, role } = useRole();
  const { lang } = useLang();
  const labels = OWNERSHIP_TRANSFER_L[lang];

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState("");

  const isOwner = role === "tenant_owner";
  // Owner-scoped reads — only fire when this card actually renders (owner + tenant).
  const enabled = isOwner && !!tenantId;
  const tid = tenantId ?? "";

  const masters = api.salon.getMasters.useQuery({ tenantId: tid }, { enabled });
  const billing = api.salon.getBillingStatus.useQuery({ tenantId: tid }, { enabled });
  const pending = api.ownership.getPending.useQuery(
    { tenantId: tid },
    // Tolerate the router being absent during incremental rollout.
    { enabled, retry: false },
  );
  const requestTransfer = api.ownership.requestTransfer.useMutation({
    onSuccess: () => { pending.refetch(); setConfirmOpen(false); setSelectedTarget(""); },
  });
  const cancelTransfer = api.ownership.cancelTransfer.useMutation({
    onSuccess: () => { pending.refetch(); },
  });

  if (!isOwner || !tenantId) return null;

  const planOk = billing.data?.billingStatus !== "inactive" && billing.data?.billingStatus !== "expired";
  const hasPending = !!pending.data;

  // Only masters with a known webUserId can receive ownership.
  const transferCandidates = (masters.data ?? []).filter((m: any) =>
    m.webUserId && !m.deletedAt,
  );

  return (
    <>
      <CollapsibleSection
        icon={Crown}
        iconClass="text-rose-400"
        title={labels.transferTitle}
        // Surface an in-flight transfer without making the owner expand the row.
        defaultOpen={hasPending}
      >
        <div className="space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">{labels.transferDesc}</p>

          {hasPending ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <div className="flex items-start gap-2.5">
                <Mail className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                    {labels.transferPending}
                  </p>
                  {pending.data?.toName && (
                    <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-1 truncate">
                      {labels.pendingTo}: {pending.data.toName} ({pending.data.toEmail})
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={cancelTransfer.isPending}
                  onClick={() => cancelTransfer.mutate({ tenantId })}
                  className="shrink-0 rounded-lg bg-amber-500/15 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 disabled:opacity-60"
                >
                  {cancelTransfer.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : labels.cancelTransfer}
                </button>
              </div>
            </div>
          ) : !planOk ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-300">{labels.notReady}</p>
            </div>
          ) : transferCandidates.length === 0 ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-white/[0.02] p-3 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-600 dark:text-slate-400">{labels.noCandidates}</p>
            </div>
          ) : (
            <>
              <Btn
                onClick={() => setConfirmOpen(true)}
                className="w-full justify-center"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                {labels.transferBtn}
              </Btn>
              <ul className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1 mt-1">
                <li className="flex items-center gap-1.5"><ShieldCheck className="h-3 w-3" />{labels.safety1}</li>
                <li className="flex items-center gap-1.5"><Mail className="h-3 w-3" />{labels.safety2}</li>
                <li className="flex items-center gap-1.5"><ShieldCheck className="h-3 w-3" />{labels.safety3}</li>
              </ul>
            </>
          )}
        </div>
      </CollapsibleSection>

      {/* Confirm modal — recipient picker */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">{labels.confirmTitle}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{labels.confirmHint}</p>
              </div>
              <button onClick={() => setConfirmOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2 mb-4 max-h-72 overflow-y-auto">
              {transferCandidates.map((m: any) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedTarget(String(m.webUserId))}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                    selectedTarget === String(m.webUserId)
                      ? "bg-brand-500/10 ring-1 ring-brand-500/40"
                      : "bg-slate-50 dark:bg-white/[0.03] hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                  }`}
                >
                  {m.photo ? (
                    <img src={m.photo} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                      <UserRound className="h-3.5 w-3.5 text-slate-500" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{m.name || "—"}</p>
                  </div>
                </button>
              ))}
            </div>
            {requestTransfer.error && (
              <p className="text-xs text-red-500 mb-3">{requestTransfer.error.message}</p>
            )}
            <Btn
              onClick={() => requestTransfer.mutate({ tenantId, targetWebUserId: selectedTarget })}
              disabled={!selectedTarget || requestTransfer.isPending}
              className="w-full justify-center"
            >
              {requestTransfer.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
              {labels.send}
            </Btn>
          </div>
        </div>
      )}
    </>
  );
}
