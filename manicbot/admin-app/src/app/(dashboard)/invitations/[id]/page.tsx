"use client";

/**
 * Accept-invitation page for Scenario A of salon.sendMasterInvitation.
 * Reached via the email link or in-app bell `${baseUrl}/invitations/<id>`.
 * Requires the caller to be logged in as the same email the invitation was
 * sent to.
 *
 * The page calls salon.getInvitationContext first to fetch:
 *   - salonName / inviterEmail / scenario / status (drives the headline + warnings)
 *   - emailMatch (caller's email vs invitation email; gates the Accept button)
 *   - callerOwnsOtherTenant + callerTenantName (drives the dual-role disclaimer
 *     when the caller is already a tenant_owner of a different non-personal
 *     salon — important: they DON'T lose their own salon, they pick up an
 *     additional master role)
 *
 * On Accept, creates a `masters` row in the inviter's tenant (origin=
 * 'invited_email'), inserts the matching tenant_roles row, and marks the
 * invitation accepted. Routes to the new tenant's dashboard.
 */

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Loader2, CheckCircle2, AlertTriangle, Briefcase, Users } from "lucide-react";
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

  const { update } = useSession();
  const utils = api.useUtils();
  const ctxQuery = api.salon.getInvitationContext.useQuery({ invitationId: id });

  const accept = api.webUsers.acceptInvitationExistingUser.useMutation({
    onSuccess: async () => {
      // Accept set web_users.active_tenant_id to this salon. Refresh the
      // session so the JWT re-resolves (tenantId, role) → invited salon as
      // master, then land on the dashboard (now MasterDashboard for it).
      await update();
      // Invalidate ALL caches (not just getMyRole): the caller now has a NEW
      // membership, so the header salon switcher's `listMyTenants` query —
      // primed to 1 item while this page rendered inside WebShell — must
      // refetch, otherwise the switcher stays hidden (items.length < 2) until
      // a full reload. Mirrors TenantSwitcher.choose()'s post-switch reset.
      await utils.invalidate();
      router.replace("/dashboard");
    },
    onError: (e) => setError(e.message),
  });

  const labels = (() => {
    switch (lang) {
      case "ru":
        return {
          title: "Приглашение в салон",
          headline: (salon: string) => `Салон «${salon}» приглашает вас работать мастером`,
          invitedBy: "Отправитель:",
          accept: "Принять и перейти к панели",
          notFound: "Приглашение не найдено или истекло.",
          notPending: "Приглашение уже использовано или отменено.",
          mismatch: (email: string) => `Это приглашение отправлено на другой email (${email}). Выйдите и войдите под нужным аккаунтом.`,
          processing: "Принимаем приглашение…",
          loading: "Загружаем приглашение…",
          dualRoleTitle: "У вас уже есть свой салон",
          dualRoleBody: (own: string, target: string) =>
            `Вы остаётесь владельцем «${own}». Принимая приглашение, вы дополнительно становитесь мастером в салоне «${target}» — это не объединение и не передача. Переключаться можно прямо в шапке панели.`,
          loginAs: (email: string) => `Войдите как ${email}, чтобы принять.`,
          alreadyExpired: "Срок приглашения истёк. Попросите салон отправить новое.",
        };
      case "ua":
        return {
          title: "Запрошення в салон",
          headline: (salon: string) => `Салон «${salon}» запрошує вас працювати майстром`,
          invitedBy: "Відправник:",
          accept: "Прийняти і перейти до панелі",
          notFound: "Запрошення не знайдено або прострочене.",
          notPending: "Запрошення вже використано або скасовано.",
          mismatch: (email: string) => `Це запрошення надіслано на інший email (${email}). Вийдіть і увійдіть під потрібним акаунтом.`,
          processing: "Приймаємо запрошення…",
          loading: "Завантажуємо запрошення…",
          dualRoleTitle: "У вас уже є власний салон",
          dualRoleBody: (own: string, target: string) =>
            `Ви залишаєтесь власником «${own}». Приймаючи запрошення, ви додатково стаєте майстром у салоні «${target}» — це не об'єднання і не передача. Перемикатися можна в шапці панелі.`,
          loginAs: (email: string) => `Увійдіть як ${email}, щоб прийняти.`,
          alreadyExpired: "Термін запрошення сплив. Попросіть салон надіслати нове.",
        };
      case "pl":
        return {
          title: "Zaproszenie do salonu",
          headline: (salon: string) => `Salon „${salon}" zaprasza Cię do pracy jako mistrz`,
          invitedBy: "Nadawca:",
          accept: "Zaakceptuj i przejdź do panelu",
          notFound: "Zaproszenie nie znalezione lub wygasło.",
          notPending: "Zaproszenie zostało już użyte lub anulowane.",
          mismatch: (email: string) => `To zaproszenie zostało wysłane na inny email (${email}). Wyloguj się i zaloguj na właściwe konto.`,
          processing: "Akceptujemy zaproszenie…",
          loading: "Wczytywanie zaproszenia…",
          dualRoleTitle: "Masz już własny salon",
          dualRoleBody: (own: string, target: string) =>
            `Pozostajesz właścicielem „${own}". Akceptując zaproszenie, zostajesz dodatkowo mistrzem w salonie „${target}" — to nie jest fuzja ani przekazanie. Możesz przełączać się w nagłówku panelu.`,
          loginAs: (email: string) => `Zaloguj się jako ${email}, aby zaakceptować.`,
          alreadyExpired: "Zaproszenie wygasło. Poproś salon o nowe.",
        };
      default:
        return {
          title: "Salon invitation",
          headline: (salon: string) => `${salon} is inviting you to join as a master`,
          invitedBy: "From:",
          accept: "Accept and go to dashboard",
          notFound: "Invitation not found or expired.",
          notPending: "Invitation has already been used or cancelled.",
          mismatch: (email: string) => `This invitation was sent to a different email (${email}). Sign out and sign in with the correct account.`,
          processing: "Accepting invitation…",
          loading: "Loading invitation…",
          dualRoleTitle: "You already own a salon",
          dualRoleBody: (own: string, target: string) =>
            `You stay the owner of "${own}". Accepting this invitation adds you as a master in "${target}" — it's not a merge or transfer. You can switch between them from the panel header.`,
          loginAs: (email: string) => `Sign in as ${email} to accept.`,
          alreadyExpired: "This invitation has expired. Ask the salon to send a new one.",
        };
    }
  })();

  const errorText = (() => {
    if (!error) return null;
    if (error === "invitation_not_found") return labels.notFound;
    if (error === "invitation_not_pending") return labels.notPending;
    if (error === "invitation_expired") return labels.alreadyExpired;
    if (error === "email_mismatch") return labels.mismatch(ctxQuery.data?.email ?? "");
    return error;
  })();

  return (
    <div className="mx-auto max-w-md py-16 px-4">
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center text-white"
            style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
          >
            <Users className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{labels.title}</h1>
        </div>

        {ctxQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{labels.loading}</span>
          </div>
        )}

        {ctxQuery.data && (() => {
          const c = ctxQuery.data;
          const isExpired = c.expired;
          const isPending = c.status === "pending";

          if (!isPending) {
            return (
              <div className="flex items-start gap-2 rounded-xl border border-slate-500/20 bg-slate-500/10 p-3 text-sm text-slate-700 dark:text-slate-300">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{labels.notPending}</span>
              </div>
            );
          }
          if (isExpired) {
            return (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{labels.alreadyExpired}</span>
              </div>
            );
          }

          return (
            <>
              <p className="text-base text-slate-900 dark:text-white font-medium">
                {labels.headline(c.salonName)}
              </p>
              {c.inviterEmail && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {labels.invitedBy} <span className="font-mono">{c.inviterEmail}</span>
                </p>
              )}

              {c.callerOwnsOtherTenant && c.callerTenantName && (
                <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
                    <Briefcase className="h-3.5 w-3.5" />
                    {labels.dualRoleTitle}
                  </div>
                  <p className="text-xs text-indigo-900/80 dark:text-indigo-100/80 leading-relaxed">
                    {labels.dualRoleBody(c.callerTenantName, c.salonName)}
                  </p>
                </div>
              )}

              {!c.emailMatch && (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{labels.loginAs(c.email ?? "")}</span>
                </div>
              )}

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
                disabled={accept.isPending || !c.emailMatch}
                className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
              >
                {accept.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {accept.isPending ? labels.processing : labels.accept}
              </button>
            </>
          );
        })()}

        {ctxQuery.error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              {ctxQuery.error.message === "invitation_not_found"
                ? labels.notFound
                : ctxQuery.error.message}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
