"use client";

/**
 * Accept-invitation page for Scenario A of salon.sendMasterInvitation.
 * Reached via the email link `${baseUrl}/invitations/<id>`. Requires the
 * caller to be logged in as the same email the invitation was sent to.
 *
 * On Accept, creates a `masters` row in the inviter's tenant (origin=
 * 'invited_email'), inserts the matching tenant_roles row, and marks the
 * invitation accepted. Routes to the new tenant's MasterDashboard.
 */

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { api } from "~/trpc/react";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function InvitationAcceptPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { lang } = useLang();
  const [error, setError] = useState<string | null>(null);

  const accept = api.webUsers.acceptInvitationExistingUser.useMutation({
    onSuccess: (data) => {
      router.replace(`/dashboard?tab=overview&tenant=${encodeURIComponent(data.tenantId)}`);
    },
    onError: (e) => setError(e.message),
  });

  const labels = (() => {
    switch (lang) {
      case "ru":
        return {
          title: "Принять приглашение",
          body: "Салон пригласил вас стать мастером. Нажмите кнопку, чтобы принять.",
          accept: "Принять и перейти к панели",
          notFound: "Приглашение не найдено или истекло.",
          notPending: "Приглашение уже использовано или отменено.",
          mismatch: "Это приглашение отправлено на другой email. Войдите под нужным аккаунтом.",
          processing: "Принимаем приглашение…",
        };
      case "ua":
        return {
          title: "Прийняти запрошення",
          body: "Салон запросив вас стати майстром. Натисніть, щоб прийняти.",
          accept: "Прийняти і перейти до панелі",
          notFound: "Запрошення не знайдено або прострочене.",
          notPending: "Запрошення вже використано або скасовано.",
          mismatch: "Це запрошення надіслано на інший email. Увійдіть під потрібним акаунтом.",
          processing: "Приймаємо запрошення…",
        };
      case "pl":
        return {
          title: "Zaakceptuj zaproszenie",
          body: "Salon zaprosił Cię, abyś dołączył jako mistrz. Kliknij, aby zaakceptować.",
          accept: "Zaakceptuj i przejdź do panelu",
          notFound: "Zaproszenie nie znalezione lub wygasło.",
          notPending: "Zaproszenie zostało już użyte lub anulowane.",
          mismatch: "To zaproszenie zostało wysłane na inny email. Zaloguj się na właściwe konto.",
          processing: "Akceptujemy zaproszenie…",
        };
      default:
        return {
          title: "Accept invitation",
          body: "A salon invited you to join as a master. Click to accept.",
          accept: "Accept and go to dashboard",
          notFound: "Invitation not found or expired.",
          notPending: "Invitation has already been used or cancelled.",
          mismatch: "This invitation was sent to a different email. Sign in with the correct account.",
          processing: "Accepting invitation…",
        };
    }
  })();

  const errorText = error
    ? error === "invitation_not_found"
      ? labels.notFound
      : error === "invitation_not_pending"
      ? labels.notPending
      : error === "invitation_expired"
      ? labels.notFound
      : error === "email_mismatch"
      ? labels.mismatch
      : error
    : null;

  return (
    <div className="mx-auto max-w-md py-16 px-4">
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center text-white"
            style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
          >
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{labels.title}</h1>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300">{labels.body}</p>

        {errorText && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{errorText}</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setError(null);
            accept.mutate({ invitationId: id });
          }}
          disabled={accept.isPending}
          className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
        >
          {accept.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {accept.isPending ? labels.processing : labels.accept}
        </button>
      </div>
    </div>
  );
}
