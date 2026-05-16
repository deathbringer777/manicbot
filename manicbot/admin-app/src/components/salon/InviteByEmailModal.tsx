"use client";

/**
 * InviteByEmailModal — third add-master path on the Masters tab.
 *
 * Flow:
 *   1. Owner enters an email; submit calls salon.sendMasterInvitation.
 *   2. Server resolves scenario (existing_user / new_user) and returns it
 *      so the modal can show a precise success copy. Bottom status bar:
 *      green on success, red on error, neutral while idle.
 *   3. On CONFLICT 'invitation_already_pending', the UI surfaces an inline
 *      hint suggesting Revoke + Resend via the pending-invitations strip.
 *
 * No OTP gate here: invitations are reversible (revoke) and bounded by the
 * 10/h per-inviter rate-limit on the server.
 */

import { useState } from "react";
import { Mail, Send, Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";

interface InviteByEmailModalProps {
  tenantId: string;
  onClose: () => void;
}

export function InviteByEmailModal({ tenantId, onClose }: InviteByEmailModalProps) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "error"; message: string }
    | { kind: "success"; scenario: "existing_user" | "new_user" }
  >({ kind: "idle" });

  const send = api.salon.sendMasterInvitation.useMutation({
    onSuccess: (data) => {
      setStatus({ kind: "success", scenario: data.scenario });
      void utils.salon.listMasterInvitations.invalidate({ tenantId });
    },
    onError: (e) => {
      const m = e.message;
      setStatus({ kind: "error", message: m });
    },
  });

  const labels = (() => {
    switch (lang) {
      case "ru":
        return {
          title: "Пригласить мастера по email",
          emailPh: "master@example.com",
          name: "Имя (необязательно)",
          namePh: "Анна",
          submit: "Отправить приглашение",
          successExisting: "Отправлено — у пользователя уже есть аккаунт",
          successNew: "Отправлено — мы попросили зарегистрироваться",
          errorRate: "Слишком много приглашений за час. Подождите.",
          errorDup: "Приглашение уже отправлено. Отмените его и попробуйте снова.",
          errorPersonal: "Нельзя приглашать в персональный салон.",
          errorOther: "Не удалось отправить. Проверьте формат email.",
          cancel: "Закрыть",
          done: "Готово",
          hint: "Если у получателя есть аккаунт ManicBot — приглашение придёт в раздел сообщений. Если нет — ему придёт ссылка на регистрацию с предзаполненным email.",
        };
      case "ua":
        return {
          title: "Запросити майстра по email",
          emailPh: "master@example.com",
          name: "Імʼя (необовʼязково)",
          namePh: "Анна",
          submit: "Надіслати запрошення",
          successExisting: "Надіслано — у користувача вже є акаунт",
          successNew: "Надіслано — ми попросили зареєструватися",
          errorRate: "Забагато запрошень за годину. Зачекайте.",
          errorDup: "Запрошення вже надіслано. Скасуйте його і спробуйте знову.",
          errorPersonal: "Не можна запрошувати в персональний салон.",
          errorOther: "Не вдалося надіслати. Перевірте формат email.",
          cancel: "Закрити",
          done: "Готово",
          hint: "Якщо в одержувача є акаунт ManicBot — запрошення прийде в розділ повідомлень. Якщо ні — йому прийде посилання на реєстрацію з заповненим email.",
        };
      case "pl":
        return {
          title: "Zaproś mistrza przez email",
          emailPh: "master@example.com",
          name: "Imię (opcjonalne)",
          namePh: "Anna",
          submit: "Wyślij zaproszenie",
          successExisting: "Wysłano — użytkownik ma już konto",
          successNew: "Wysłano — poprosiliśmy o rejestrację",
          errorRate: "Za dużo zaproszeń w godzinę. Poczekaj.",
          errorDup: "Zaproszenie już wysłane. Anuluj je i spróbuj ponownie.",
          errorPersonal: "Nie można zapraszać do osobistego salonu.",
          errorOther: "Nie udało się wysłać. Sprawdź format email.",
          cancel: "Zamknij",
          done: "Gotowe",
          hint: "Jeśli odbiorca ma konto ManicBot — zaproszenie trafi do wiadomości. Jeśli nie — otrzyma link rejestracyjny z wypełnionym emailem.",
        };
      default:
        return {
          title: "Invite master by email",
          emailPh: "master@example.com",
          name: "Display name (optional)",
          namePh: "Anna",
          submit: "Send invitation",
          successExisting: "Sent — recipient already has an account",
          successNew: "Sent — they've been asked to register",
          errorRate: "Too many invitations this hour. Try again later.",
          errorDup: "Invitation already pending. Revoke it and try again.",
          errorPersonal: "Cannot invite into a personal-master tenant.",
          errorOther: "Could not send. Check the email format.",
          cancel: "Close",
          done: "Done",
          hint: "If the recipient already has a ManicBot account — the invitation lands in their messages. If not — they get a registration link with the email pre-filled.",
        };
    }
  })();

  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  function statusBar() {
    if (status.kind === "idle") return null;
    const isOk = status.kind === "success";
    const text =
      status.kind === "success"
        ? status.scenario === "existing_user"
          ? labels.successExisting
          : labels.successNew
        : (() => {
            const m = status.message;
            if (m === "rate_limited") return labels.errorRate;
            if (m === "invitation_already_pending") return labels.errorDup;
            if (m === "personal_tenant_cannot_invite") return labels.errorPersonal;
            return labels.errorOther;
          })();
    return (
      <div
        className={`mt-3 rounded-xl px-3 py-2 text-sm ${
          isOk
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
            : "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20"
        }`}
        role="status"
      >
        {text}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
          <div
            className="h-9 w-9 rounded-xl flex items-center justify-center text-white"
            style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
          >
            <Mail className="h-4 w-4" />
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{labels.title}</h3>
        </div>

        <div className="p-5 space-y-3">
          {status.kind === "success" ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">{labels.hint}</p>
          ) : (
            <>
              <div>
                <input
                  type="email"
                  inputMode="email"
                  autoFocus
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (status.kind === "error") setStatus({ kind: "idle" });
                  }}
                  placeholder={labels.emailPh}
                  className="w-full rounded-xl px-3 py-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/60"
                />
              </div>
              <div>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={`${labels.name} — ${labels.namePh}`}
                  className="w-full rounded-xl px-3 py-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/60"
                />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{labels.hint}</p>
            </>
          )}

          {statusBar()}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              {status.kind === "success" ? labels.done : labels.cancel}
            </button>
            {status.kind !== "success" && (
              <button
                type="button"
                onClick={() =>
                  send.mutate({
                    tenantId,
                    email: email.trim().toLowerCase(),
                    displayName: displayName.trim() || undefined,
                  })
                }
                disabled={!isValid || send.isPending}
                className="flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
              >
                {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {labels.submit}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
