"use client";

import { useState, useRef, useEffect } from "react";
import { User, Mail, Key, CheckCircle, Save, ShieldCheck, ShieldAlert, Loader2, ArrowLeftRight, Clock, Check, XCircle } from "lucide-react";
import { toast } from "sonner";
import { signOut } from "next-auth/react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { friendlyRoleName } from "~/lib/roleLabels";
import type { Lang } from "~/lib/i18n";
import { CollapsibleSection } from "~/components/settings/CollapsibleSection";
import { SettingsHeaderStrip } from "~/components/settings/SettingsHeaderStrip";

/**
 * Returns true while the component is mounted. Use to guard setState calls
 * inside async callbacks that may resolve after the component is unmounted —
 * notably mutation `onSuccess` handlers that trigger a query invalidate which
 * flips a parent's conditional render branch.
 */
function useMountedRef(): React.MutableRefObject<boolean> {
  const ref = useRef(true);
  useEffect(() => {
    ref.current = true;
    return () => { ref.current = false; };
  }, []);
  return ref;
}

const VERIFY_L: Record<Lang, {
  verified: string;
  notVerified: string;
  promptSend: string;
  enterCode: string;
  sendCode: string;
  verify: string;
  resend: string;
  resendCooldown: string;
  success: string;
}> = {
  ru: {
    verified: "Email подтверждён",
    notVerified: "Email не подтверждён",
    promptSend: "Нажмите «Отправить код» — мы пришлём его на ваш email",
    enterCode: "Введите код подтверждения из письма",
    sendCode: "Отправить код",
    verify: "Подтвердить",
    resend: "Отправить код повторно",
    resendCooldown: "Код отправлен",
    success: "Email успешно подтверждён!",
  },
  ua: {
    verified: "Email підтверджено",
    notVerified: "Email не підтверджено",
    promptSend: "Натисніть «Надіслати код» — ми надішлемо його на ваш email",
    enterCode: "Введіть код підтвердження з листа",
    sendCode: "Надіслати код",
    verify: "Підтвердити",
    resend: "Надіслати код повторно",
    resendCooldown: "Код надіслано",
    success: "Email успішно підтверджено!",
  },
  en: {
    verified: "Email verified",
    notVerified: "Email not verified",
    promptSend: "Click «Send code» — we'll email it to you",
    enterCode: "Enter the verification code from your email",
    sendCode: "Send code",
    verify: "Verify",
    resend: "Resend code",
    resendCooldown: "Code sent",
    success: "Email verified successfully!",
  },
  pl: {
    verified: "Email potwierdzony",
    notVerified: "Email nie potwierdzony",
    promptSend: "Kliknij «Wyślij kod» — wyślemy go na Twój email",
    enterCode: "Wpisz 6-cyfrowy kod z emaila",
    sendCode: "Wyślij kod",
    verify: "Potwierdź",
    resend: "Wyślij kod ponownie",
    resendCooldown: "Kod wysłany",
    success: "Email potwierdzony pomyślnie!",
  },
};

const ROLE_CHANGE_L: Record<Lang, {
  heading: string;
  currentRole: string;
  requestTo: string;
  reason: string;
  reasonPlaceholder: string;
  submit: string;
  pending: string;
  pendingDesc: string;
  approved: string;
  denied: string;
  adminNote: string;
  newRequest: string;
  alreadyPending: string;
}> = {
  ru: {
    heading: "Смена роли",
    currentRole: "Текущая роль",
    requestTo: "Запросить роль",
    reason: "Причина (необязательно)",
    reasonPlaceholder: "Почему вы хотите сменить роль?",
    submit: "Отправить запрос",
    pending: "На рассмотрении",
    pendingDesc: "Ваш запрос на смену роли ожидает рассмотрения администратором.",
    approved: "Одобрено",
    denied: "Отклонено",
    adminNote: "Комментарий администратора",
    newRequest: "Новый запрос",
    alreadyPending: "У вас уже есть активный запрос",
  },
  ua: {
    heading: "Зміна ролі",
    currentRole: "Поточна роль",
    requestTo: "Запросити роль",
    reason: "Причина (необов'язково)",
    reasonPlaceholder: "Чому ви хочете змінити роль?",
    submit: "Надіслати запит",
    pending: "На розгляді",
    pendingDesc: "Ваш запит на зміну ролі очікує на розгляд адміністратором.",
    approved: "Схвалено",
    denied: "Відхилено",
    adminNote: "Коментар адміністратора",
    newRequest: "Новий запит",
    alreadyPending: "У вас вже є активний запит",
  },
  en: {
    heading: "Change Role",
    currentRole: "Current role",
    requestTo: "Request role",
    reason: "Reason (optional)",
    reasonPlaceholder: "Why do you want to change your role?",
    submit: "Submit request",
    pending: "Pending review",
    pendingDesc: "Your role change request is waiting for admin review.",
    approved: "Approved",
    denied: "Denied",
    adminNote: "Admin note",
    newRequest: "New request",
    alreadyPending: "You already have a pending request",
  },
  pl: {
    heading: "Zmiana roli",
    currentRole: "Obecna rola",
    requestTo: "Żądaj roli",
    reason: "Powód (opcjonalnie)",
    reasonPlaceholder: "Dlaczego chcesz zmienić rolę?",
    submit: "Wyślij prośbę",
    pending: "Oczekuje na przegląd",
    pendingDesc: "Twoja prośba o zmianę roli czeka na zatwierdzenie przez administratora.",
    approved: "Zatwierdzona",
    denied: "Odrzucona",
    adminNote: "Komentarz administratora",
    newRequest: "Nowa prośba",
    alreadyPending: "Masz już aktywną prośbę",
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Sensitive-action OTP. A 6-digit code emailed to the CURRENT account address
// (via the otp.request router) gates the password and role cards below: fill
// the form → "Send code" → enter the code → confirm (the gated mutation is
// called with `otpCode`). The code is always sent to ctx.webUser.email
// server-side, so a hijacked session alone — without the registered mailbox —
// cannot complete the change.
//
// The email card uses the same step-up principle but its own issuer
// (requestEmailChange validates the new address, then emails one code), so it
// does NOT go through this otp.request flow — see handleChangeEmail below.
// ─────────────────────────────────────────────────────────────────────────

type OtpAction = "change_password" | "change_role";

const OTP_L: Record<Lang, {
  sendCode: string;
  resend: string;
  enterCode: string;
  sentTo: string;
  sending: string;
  labels: Record<OtpAction, string>;
}> = {
  ru: {
    sendCode: "Отправить код",
    resend: "Отправить код повторно",
    enterCode: "Код подтверждения из письма",
    sentTo: "Код отправлен на",
    sending: "Отправка…",
    labels: { change_password: "Смена пароля", change_role: "Смена роли" },
  },
  ua: {
    sendCode: "Надіслати код",
    resend: "Надіслати код повторно",
    enterCode: "Код підтвердження з листа",
    sentTo: "Код надіслано на",
    sending: "Надсилання…",
    labels: { change_password: "Зміна пароля", change_role: "Зміна ролі" },
  },
  en: {
    sendCode: "Send code",
    resend: "Resend code",
    enterCode: "Confirmation code from the email",
    sentTo: "Code sent to",
    sending: "Sending…",
    labels: { change_password: "Change password", change_role: "Change role" },
  },
  pl: {
    sendCode: "Wyślij kod",
    resend: "Wyślij kod ponownie",
    enterCode: "Kod potwierdzający z e-maila",
    sentTo: "Kod wysłano na",
    sending: "Wysyłanie…",
    labels: { change_password: "Zmiana hasła", change_role: "Zmiana roli" },
  },
};

const OTP_ERR_L: Record<Lang, Record<string, string>> = {
  ru: { otp_required: "Сначала запросите код", otp_invalid: "Неверный код", otp_expired: "Код истёк — запросите новый", otp_exhausted: "Слишком много попыток — запросите новый код", otp_consumed: "Код уже использован — запросите новый" },
  ua: { otp_required: "Спершу запросіть код", otp_invalid: "Невірний код", otp_expired: "Код прострочено — запросіть новий", otp_exhausted: "Забагато спроб — запросіть новий код", otp_consumed: "Код уже використано — запросіть новий" },
  en: { otp_required: "Request a code first", otp_invalid: "Invalid code", otp_expired: "Code expired — request a new one", otp_exhausted: "Too many attempts — request a new code", otp_consumed: "Code already used — request a new one" },
  pl: { otp_required: "Najpierw poproś o kod", otp_invalid: "Nieprawidłowy kod", otp_expired: "Kod wygasł — poproś o nowy", otp_exhausted: "Zbyt wiele prób — poproś o nowy kod", otp_consumed: "Kod już użyty — poproś o nowy" },
};

/** Map a stable server OTP error message to localized text; pass others through. */
function mapOtpError(msg: string | undefined, lang: Lang): string {
  if (!msg) return "";
  return OTP_ERR_L[lang]?.[msg] ?? msg;
}

const DANGER_L: Record<Lang, { title: string; subtitle: string }> = {
  ru: { title: "Опасная зона", subtitle: "Изменения требуют кода подтверждения с email" },
  ua: { title: "Небезпечна зона", subtitle: "Зміни потребують коду підтвердження з email" },
  en: { title: "Danger zone", subtitle: "These changes require an email confirmation code" },
  pl: { title: "Strefa niebezpieczna", subtitle: "Te zmiany wymagają kodu potwierdzającego z e-maila" },
};

/** Independent send-code / enter-code state for one sensitive action. */
function useOtpFlow() {
  const [otpCode, setOtpCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);

  const requestMut = (api as any).otp.request.useMutation({
    onSuccess: (data: { sentTo?: string }) => {
      setCodeSent(true);
      setSentTo(data?.sentTo ?? null);
      setOtpError(null);
    },
    onError: (err: { message?: string }) => {
      setOtpError(err.message ?? "Failed to send code");
    },
  }) as { mutate: (a: { action: string; payload: unknown; actionLabel: string }) => void; isPending: boolean };

  const requestCode = (action: OtpAction, payload: unknown, actionLabel: string) => {
    setOtpError(null);
    requestMut.mutate({ action, payload, actionLabel });
  };
  const reset = () => { setOtpCode(""); setCodeSent(false); setSentTo(null); setOtpError(null); };

  return { otpCode, setOtpCode, codeSent, sentTo, otpError, requestCode, reset, sending: requestMut.isPending };
}

/** 6-digit code input — shared styling across the danger-zone cards. */
function OtpCodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]{6}"
      autoComplete="one-time-code"
      maxLength={6}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      placeholder="000000"
      className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-slate-900 dark:text-white tracking-[0.5em] text-center font-mono"
    />
  );
}

export function AccountSection() {
  const { role, previewRole, emailVerified, hasPassword } = useRole();
  const { lang } = useLang();
  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  const vl = VERIFY_L[lang];
  const ol = OTP_L[lang];
  const dl = DANGER_L[lang];
  const utils = api.useUtils();

  // OTP flows for the password and role cards (code → current email). The email
  // card uses its own requestEmailChange/confirmEmailChange pair instead — that
  // mutation is the issuer (it validates the address before sending the code).
  const pwOtp = useOtpFlow();
  const roleOtp = useOtpFlow();

  // Verification code
  const mounted = useMountedRef();
  const [code, setCode] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifySuccess, setVerifySuccess] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const verifyMut = (api as any).webUsers.verifyEmail.useMutation({
    onSuccess: (data: { alreadyVerified?: boolean }) => {
      if (data?.alreadyVerified) {
        // Was already verified in DB — just refresh the UI state
        utils.auth.getMyRole.invalidate();
        return;
      }
      // Guard setState — emailVerified flip doesn't unmount AccountSection,
      // but defensive against future refactors that add a conditional wrapper.
      if (mounted.current) {
        setVerifySuccess(true);
        setVerifyError(null);
        setCode("");
      }
      utils.auth.getMyRole.invalidate();
    },
    onError: (err: { message?: string }) => {
      if (mounted.current) setVerifyError(err.message ?? "Verification failed");
    },
  }) as { mutate: (args: { email: string; code: string }) => void; isPending: boolean };

  const resendMut = (api as any).webUsers.resendVerificationCode.useMutation({
    onSuccess: () => {
      if (!mounted.current) return;
      setCodeSent(true);
      setResendCooldown(true);
      setTimeout(() => { if (mounted.current) setResendCooldown(false); }, 60000);
    },
    onError: (err: { message?: string }) => {
      if (mounted.current) setVerifyError(err.message ?? "Failed to send code");
    },
  }) as { mutate: (args: { email: string }) => void; isPending: boolean };

  // Get user email from role query for verification calls
  const roleQuery = api.auth.getMyRole.useQuery();
  const sessionEmail = (roleQuery.data as any)?.email ?? "";

  // Change password
  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [pwError, setPwError] = useState<string | null>(null);
  // No local pwSuccess — onSuccess uses toast + signOut (see changePasswordMut below).

  // changePassword bumps password_changed_at server-side which marks the
  // existing JWT stale (#S8 in auth.ts). Show a toast confirming the change,
  // then sign out so the user re-authenticates with the new credentials.
  // This is the same security-correct flow most banks/SaaS apps use.
  const changePasswordMut = (api as any).webUsers.changePassword.useMutation({
    onSuccess: () => {
      toast.success(t("settings.passwordChangedOk", lang));
      if (mounted.current) {
        setPwError(null);
        setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
        pwOtp.reset();
      }
      setTimeout(() => {
        void signOut({ callbackUrl: "/login?reason=password_changed" });
      }, 700);
    },
    onError: (err: { message?: string }) => {
      if (mounted.current) setPwError(mapOtpError(err.message, lang) || t("settings.passwordError", lang));
    },
  }) as { mutate: (args: { currentPassword: string; newPassword: string; otpCode: string }) => void; isPending: boolean };

  // Phase 1 — validate the form locally, then email a code to the current address.
  const handleSendPwCode = () => {
    setPwError(null);
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError(t("settings.passwordMismatch", lang));
      return;
    }
    pwOtp.requestCode("change_password", {}, ol.labels.change_password);
  };

  // Phase 2 — confirm with the 6-digit code.
  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError(t("settings.passwordMismatch", lang));
      return;
    }
    if (pwOtp.otpCode.length !== 6) return;
    changePasswordMut.mutate({
      currentPassword: pwForm.currentPassword,
      newPassword: pwForm.newPassword,
      otpCode: pwOtp.otpCode,
    });
  };

  // Change email — two-step flow (#N1): request → code-confirm
  const [emailForm, setEmailForm] = useState({ newEmail: "" });
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailRequested, setEmailRequested] = useState(false);
  const [emailChangeSuccess, setEmailChangeSuccess] = useState(false);
  const [emailChangeCode, setEmailChangeCode] = useState("");

  const changeEmailMut = (api as any).webUsers.requestEmailChange.useMutation({
    onSuccess: () => {
      setEmailRequested(true);
      setEmailError(null);
    },
    onError: (err: { message?: string }) => {
      setEmailError(err.message ?? t("settings.emailChangeError", lang));
    },
  }) as { mutate: (args: { newEmail: string }) => void; isPending: boolean };

  const confirmEmailMut = (api as any).webUsers.confirmEmailChange.useMutation({
    onSuccess: () => {
      setEmailChangeSuccess(true);
      setEmailError(null);
      // Email change bumps password_changed_at, so JWT will be rejected on
      // next session check. Sign out to refresh.
      setTimeout(() => {
        void signOut({ callbackUrl: "/login?reason=email_changed" });
      }, 1500);
    },
    onError: (err: { message?: string }) => {
      setEmailError(mapOtpError(err.message, lang) || t("settings.emailChangeError", lang));
    },
  }) as { mutate: (args: { newEmail: string; otpCode: string }) => void; isPending: boolean };

  // Step 1 — server validates the new address, then emails a single OTP to the
  // CURRENT account address (requestEmailChange is the issuer; no separate
  // otp.request call, so only one code exists).
  const handleChangeEmail = (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);
    if (!emailForm.newEmail.trim()) return;
    changeEmailMut.mutate({ newEmail: emailForm.newEmail });
  };

  // Step 2 — confirm with that one code; newEmail is re-sent so the server can
  // verify the OTP's payload binding.
  const handleConfirmEmail = (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);
    if (!/^\d{6}$/.test(emailChangeCode)) {
      setEmailError(t("settings.invalidCode", lang));
      return;
    }
    confirmEmailMut.mutate({ newEmail: emailForm.newEmail, otpCode: emailChangeCode });
  };

  // Role change request
  const rcl = ROLE_CHANGE_L[lang];
  const canRequestRoleChange = effectiveRole === "tenant_owner" || effectiveRole === "master";
  const targetRole = effectiveRole === "tenant_owner" ? "master" : "tenant_owner";
  const [rcReason, setRcReason] = useState("");
  const [rcError, setRcError] = useState<string | null>(null);
  const [rcSuccess, setRcSuccess] = useState(false);

  const myRequestQuery = canRequestRoleChange
    ? (api as any).roleChangeRequests.getMyRequest.useQuery()
    : { data: null, isLoading: false };
  const myRequest = (myRequestQuery as any).data as {
    id: string; status: string; requestedRole: string; adminNote: string | null; createdAt: number;
  } | null;

  const requestRoleChangeMut = (api as any).roleChangeRequests.requestRoleChange.useMutation({
    onSuccess: () => {
      setRcSuccess(true);
      setRcError(null);
      setRcReason("");
      roleOtp.reset();
      (myRequestQuery as any).refetch?.();
    },
    onError: (err: { message?: string }) => {
      setRcError(mapOtpError(err.message, lang) || "Failed to submit request");
    },
  }) as { mutate: (args: { requestedRole: string; reason?: string; otpCode: string }) => void; isPending: boolean };

  // Phase 1 — email a code to the current address (bound to the requested role).
  const handleSendRoleCode = () => {
    setRcError(null);
    setRcSuccess(false);
    roleOtp.requestCode("change_role", { requestedRole: targetRole }, ol.labels.change_role);
  };

  // Phase 2 — confirm with the 6-digit code.
  const handleRoleChangeRequest = (e: React.FormEvent) => {
    e.preventDefault();
    setRcError(null);
    setRcSuccess(false);
    if (roleOtp.otpCode.length !== 6) return;
    requestRoleChangeMut.mutate({
      requestedRole: targetRole,
      ...(rcReason.trim() ? { reason: rcReason.trim() } : {}),
      otpCode: roleOtp.otpCode,
    });
  };

  const handleVerifyCode = (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyError(null);
    if (code.length !== 6) return;
    verifyMut.mutate({ email: sessionEmail, code });
  };

  // Pending role-change request → open the collapsible by default so the user
  // sees their status without an extra click. Same for the "set initial
  // password" flow (Google-only users who haven't picked a password yet).
  const rolePending = myRequest?.status === "pending";

  return (
    <div className="space-y-4">
      {/* Header strip when email is verified — read-only identity + status pill.
          Unverified case keeps the existing actionable card below (it IS the
          header in that state). */}
      {emailVerified ? (
        <SettingsHeaderStrip
          icon={User}
          title={sessionEmail || friendlyRoleName(effectiveRole, lang)}
          subtitle={sessionEmail ? friendlyRoleName(effectiveRole, lang) : null}
          rightSlot={
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="h-3 w-3" />
              {vl.verified}
            </span>
          }
        />
      ) : (
        <section className="glass-card rounded-2xl p-4 border border-red-500/20">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
              <ShieldAlert className="h-5 w-5 text-red-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-red-600 dark:text-red-400">{vl.notVerified}</p>
              {!verifySuccess && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{codeSent ? vl.enterCode : vl.promptSend}</p>
              )}
            </div>
          </div>

          {!verifySuccess && (
            <div className="mt-4 space-y-3">
              {!codeSent ? (
                <>
                  {verifyError && <p className="text-xs text-red-400">{verifyError}</p>}
                  <button
                    type="button"
                    onClick={() => { setVerifyError(null); resendMut.mutate({ email: sessionEmail }); }}
                    disabled={resendMut.isPending}
                    className="w-full flex items-center justify-center gap-1.5 bg-brand-600 active:bg-brand-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-brand-500/20 disabled:opacity-50"
                  >
                    {resendMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : vl.sendCode}
                  </button>
                </>
              ) : (
                <form onSubmit={handleVerifyCode} className="space-y-3">
                  <input
                    ref={codeInputRef}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setCode(v);
                      if (verifyError) setVerifyError(null);
                    }}
                    placeholder="000000"
                    className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-center text-lg font-mono tracking-[0.3em] outline-none focus:border-brand-500/60 text-slate-900 dark:text-white"
                    autoFocus
                  />
                  {verifyError && <p className="text-xs text-red-400">{verifyError}</p>}
                  <button
                    type="submit"
                    disabled={code.length !== 6 || verifyMut.isPending}
                    className="w-full flex items-center justify-center gap-1.5 bg-brand-600 active:bg-brand-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-brand-500/20 disabled:opacity-50"
                  >
                    {verifyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : vl.verify}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setVerifyError(null); resendMut.mutate({ email: sessionEmail }); }}
                    disabled={resendMut.isPending || resendCooldown}
                    className="w-full flex items-center justify-center gap-1.5 border border-slate-200 dark:border-slate-600/60 text-sm font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5 rounded-xl hover:border-brand-500/40 transition-colors disabled:opacity-50"
                  >
                    {resendMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : resendCooldown ? vl.resendCooldown : vl.resend}
                  </button>
                </form>
              )}
            </div>
          )}

          {verifySuccess && (
            <p className="text-xs text-emerald-400 flex items-center gap-1 mt-3">
              <CheckCircle className="w-3.5 h-3.5" />
              {vl.success}
            </p>
          )}
        </section>
      )}

      {/* ── Danger zone ────────────────────────────────────────────────────
          Sensitive account controls (email / password / role). Framed in red
          and gated by a one-time code emailed to the current account address. */}
      <section className="rounded-2xl border-2 border-red-500/50 bg-red-500/[0.04] p-3 sm:p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 shrink-0 text-red-500" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-red-600 dark:text-red-400">{dl.title}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{dl.subtitle}</p>
          </div>
        </div>

      {/* Change email — collapsed by default. Two-step (#N1) flow lives inside. */}
      <CollapsibleSection
        icon={Mail}
        iconClass="text-cyan-400"
        title={t("settings.changeEmail", lang)}
      >
        {!emailRequested ? (
          <form onSubmit={handleChangeEmail} className="space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                {t("settings.newEmail", lang)}
              </label>
              <input
                type="email"
                value={emailForm.newEmail}
                onChange={(e) => setEmailForm({ newEmail: e.target.value })}
                placeholder="new@example.com"
                className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-slate-900 dark:text-white"
                required
              />
            </div>
            {emailError && <p className="text-xs text-red-400">{emailError}</p>}
            <button
              type="submit"
              disabled={changeEmailMut.isPending}
              className="w-full flex items-center justify-center gap-1.5 bg-cyan-600 active:bg-cyan-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-70 mt-1"
            >
              <Mail className="w-4 h-4" />
              {changeEmailMut.isPending ? t("settings.saving", lang) : t("settings.changeEmailBtn", lang)}
            </button>
          </form>
        ) : (
          <form onSubmit={handleConfirmEmail} className="space-y-3">
            <p className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5" />
              {t("settings.emailChangeSent", lang)}
            </p>
            {/* One code — emailed to the CURRENT account address (proves it's
                you), bound server-side to the requested new address. */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                {ol.enterCode}{sessionEmail ? ` · ${ol.sentTo} ${sessionEmail}` : ""}
              </label>
              <OtpCodeInput value={emailChangeCode} onChange={setEmailChangeCode} />
            </div>
            {emailError && <p className="text-xs text-red-400">{emailError}</p>}
            {emailChangeSuccess && (
              <p className="text-xs text-emerald-400 flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" />
                {t("settings.emailChangeSuccess", lang)}
              </p>
            )}
            <button
              type="submit"
              disabled={confirmEmailMut.isPending || emailChangeCode.length !== 6}
              className="w-full flex items-center justify-center gap-1.5 bg-cyan-600 active:bg-cyan-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-70 mt-1"
            >
              {confirmEmailMut.isPending ? t("settings.saving", lang) : t("settings.confirmEmailBtn", lang)}
            </button>
            <button
              type="button"
              onClick={() => {
                setEmailRequested(false);
                setEmailChangeCode("");
                setEmailError(null);
              }}
              className="w-full text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              {t("settings.cancel", lang)}
            </button>
          </form>
        )}
      </CollapsibleSection>

      {/* Set or Change password */}
      {!hasPassword ? (
        <CollapsibleSection
          icon={Key}
          iconClass="text-amber-400"
          title={SET_PW_L[lang].heading}
          desc={SET_PW_L[lang].hint}
          defaultOpen
        >
          <SetInitialPasswordSection />
        </CollapsibleSection>
      ) : (
        <CollapsibleSection
          icon={Key}
          iconClass="text-amber-400"
          title={t("settings.changePassword", lang)}
        >
          <form onSubmit={handleChangePassword} className="space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                {t("settings.currentPassword", lang)}
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={pwForm.currentPassword}
                onChange={(e) => setPwForm((prev) => ({ ...prev, currentPassword: e.target.value }))}
                className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-slate-900 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                {t("settings.newPassword", lang)}
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={pwForm.newPassword}
                onChange={(e) => setPwForm((prev) => ({ ...prev, newPassword: e.target.value }))}
                className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-slate-900 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                {t("settings.confirmPassword", lang)}
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={pwForm.confirmPassword}
                onChange={(e) => {
                  setPwForm((prev) => ({ ...prev, confirmPassword: e.target.value }));
                  if (pwError === t("settings.passwordMismatch", lang)) setPwError(null);
                }}
                className={`w-full bg-slate-50 dark:bg-slate-900/70 border rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-slate-900 dark:text-white ${
                  pwError === t("settings.passwordMismatch", lang)
                    ? "border-red-500/60"
                    : "border-slate-200 dark:border-slate-700/50"
                }`}
                required
              />
            </div>
            {pwError && <p className="text-xs text-red-400">{pwError}</p>}
            {!pwOtp.codeSent ? (
              <button
                type="button"
                onClick={handleSendPwCode}
                disabled={pwOtp.sending}
                className="w-full flex items-center justify-center gap-1.5 bg-brand-600 active:bg-brand-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-brand-500/20 disabled:opacity-70 mt-1"
              >
                {pwOtp.sending ? <Loader2 className="h-4 w-4 animate-spin" /> : ol.sendCode}
              </button>
            ) : (
              <>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                    {ol.enterCode}{pwOtp.sentTo ? ` · ${ol.sentTo} ${pwOtp.sentTo}` : ""}
                  </label>
                  <OtpCodeInput value={pwOtp.otpCode} onChange={pwOtp.setOtpCode} />
                </div>
                {pwOtp.otpError && <p className="text-xs text-red-400">{mapOtpError(pwOtp.otpError, lang)}</p>}
                <button
                  type="submit"
                  disabled={changePasswordMut.isPending || pwOtp.otpCode.length !== 6}
                  className="w-full flex items-center justify-center gap-1.5 bg-brand-600 active:bg-brand-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-brand-500/20 disabled:opacity-70 mt-1"
                >
                  <Save className="w-4 h-4" />
                  {changePasswordMut.isPending ? t("settings.saving", lang) : t("settings.changePasswordBtn", lang)}
                </button>
                <button
                  type="button"
                  onClick={handleSendPwCode}
                  disabled={pwOtp.sending}
                  className="w-full text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  {pwOtp.sending ? ol.sending : ol.resend}
                </button>
              </>
            )}
          </form>
        </CollapsibleSection>
      )}

      {/* Role change request — auto-opens if there's a pending one so the user
          sees their status. Gated on can-request-role-change (owner / master). */}
      {canRequestRoleChange && (
        <CollapsibleSection
          icon={ArrowLeftRight}
          iconClass="text-violet-400"
          title={rcl.heading}
          defaultOpen={rolePending}
        >
          {myRequest?.status === "pending" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-amber-400">
                <Clock className="w-4 h-4" />
                <span className="text-sm font-medium">{rcl.pending}</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{rcl.pendingDesc}</p>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {rcl.requestTo}: <span className="font-medium text-violet-400">{friendlyRoleName(myRequest.requestedRole, lang)}</span>
              </div>
            </div>
          )}

          {myRequest && (myRequest.status === "approved" || myRequest.status === "denied") && (
            <div className="space-y-3">
              <div className={`flex items-center gap-2 ${myRequest.status === "approved" ? "text-emerald-400" : "text-red-400"}`}>
                {myRequest.status === "approved" ? <Check className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                <span className="text-sm font-medium">
                  {myRequest.status === "approved" ? rcl.approved : rcl.denied}
                </span>
              </div>
              {myRequest.adminNote && (
                <div className="bg-slate-50 dark:bg-slate-900/70 rounded-xl p-3 border border-slate-200 dark:border-slate-700/50">
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">{rcl.adminNote}</p>
                  <p className="text-sm text-slate-700 dark:text-slate-300">{myRequest.adminNote}</p>
                </div>
              )}
            </div>
          )}

          {(!myRequest || myRequest.status === "approved" || myRequest.status === "denied") && (
            <form onSubmit={handleRoleChangeRequest} className="space-y-3 mt-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                  {rcl.currentRole}
                </label>
                <input
                  type="text"
                  readOnly
                  value={friendlyRoleName(effectiveRole, lang)}
                  className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm text-slate-500 dark:text-slate-400 outline-none cursor-default select-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                  {rcl.requestTo}
                </label>
                <input
                  type="text"
                  readOnly
                  value={friendlyRoleName(targetRole, lang)}
                  className="w-full bg-slate-50 dark:bg-slate-900/70 border border-violet-500/20 dark:border-violet-500/20 rounded-xl px-4 py-3 text-sm text-violet-500 dark:text-violet-400 outline-none cursor-default select-none font-medium"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                  {rcl.reason}
                </label>
                <textarea
                  value={rcReason}
                  onChange={(e) => setRcReason(e.target.value)}
                  placeholder={rcl.reasonPlaceholder}
                  maxLength={500}
                  rows={2}
                  className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-500/60 text-slate-900 dark:text-white resize-none"
                />
              </div>
              {rcError && <p className="text-xs text-red-400">{rcError}</p>}
              {rcSuccess && (
                <p className="text-xs text-emerald-400 flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" />
                  {rcl.pending}
                </p>
              )}
              {!roleOtp.codeSent ? (
                <button
                  type="button"
                  onClick={handleSendRoleCode}
                  disabled={roleOtp.sending}
                  className="w-full flex items-center justify-center gap-1.5 bg-violet-600 active:bg-violet-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-violet-500/20 disabled:opacity-70 mt-1"
                >
                  {roleOtp.sending ? <Loader2 className="h-4 w-4 animate-spin" /> : ol.sendCode}
                </button>
              ) : (
                <>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                      {ol.enterCode}{roleOtp.sentTo ? ` · ${ol.sentTo} ${roleOtp.sentTo}` : ""}
                    </label>
                    <OtpCodeInput value={roleOtp.otpCode} onChange={roleOtp.setOtpCode} />
                  </div>
                  {roleOtp.otpError && <p className="text-xs text-red-400">{mapOtpError(roleOtp.otpError, lang)}</p>}
                  <button
                    type="submit"
                    disabled={requestRoleChangeMut.isPending || roleOtp.otpCode.length !== 6}
                    className="w-full flex items-center justify-center gap-1.5 bg-violet-600 active:bg-violet-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-violet-500/20 disabled:opacity-70 mt-1"
                  >
                    <ArrowLeftRight className="w-4 h-4" />
                    {requestRoleChangeMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : rcl.submit}
                  </button>
                  <button
                    type="button"
                    onClick={handleSendRoleCode}
                    disabled={roleOtp.sending}
                    className="w-full text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    {roleOtp.sending ? ol.sending : ol.resend}
                  </button>
                </>
              )}
            </form>
          )}
        </CollapsibleSection>
      )}
      </section>
    </div>
  );
}

// ─── SetInitialPasswordSection ────────────────────────────────────

const SET_PW_L: Record<Lang, {
  heading: string;
  hint: string;
  newPassword: string;
  confirmPassword: string;
  submit: string;
  mismatch: string;
  success: string;
}> = {
  ru: {
    heading: "Установить пароль",
    hint: "Вы зарегистрировались через Google. Установите пароль для входа по email.",
    newPassword: "Новый пароль",
    confirmPassword: "Повторите пароль",
    submit: "Установить пароль",
    mismatch: "Пароли не совпадают",
    success: "Пароль установлен!",
  },
  ua: {
    heading: "Встановити пароль",
    hint: "Ви зареєструвалися через Google. Встановіть пароль для входу через email.",
    newPassword: "Новий пароль",
    confirmPassword: "Повторіть пароль",
    submit: "Встановити пароль",
    mismatch: "Паролі не збігаються",
    success: "Пароль встановлено!",
  },
  en: {
    heading: "Set Password",
    hint: "You signed up with Google. Set a password to also log in with email.",
    newPassword: "New password",
    confirmPassword: "Confirm password",
    submit: "Set password",
    mismatch: "Passwords don't match",
    success: "Password set!",
  },
  pl: {
    heading: "Ustaw hasło",
    hint: "Zarejestrowałeś się przez Google. Ustaw hasło, aby logować się emailem.",
    newPassword: "Nowe hasło",
    confirmPassword: "Potwierdź hasło",
    submit: "Ustaw hasło",
    mismatch: "Hasła nie pasują",
    success: "Hasło ustawione!",
  },
};

function SetInitialPasswordSection() {
  const { lang } = useLang();
  const sl = SET_PW_L[lang];
  const utils = api.useUtils();
  const mounted = useMountedRef();
  const [form, setForm] = useState({ newPassword: "", confirmPassword: "" });
  const [error, setError] = useState<string | null>(null);

  // Why no local "success" state here:
  //   After invalidate(), the role query flips hasPassword=true → the parent
  //   AccountSection unmounts THIS component (replaces it with the change-password
  //   form). Calling setState on this component as it unmounts is what produced
  //   the React #300 we saw in production. Notify via sonner toast (detached
  //   from component lifecycle); the parent transition handles the rest.
  //
  //   We deliberately do NOT signOut here — the server-side mutation does NOT
  //   bump password_changed_at for the initial-set case (security-neutral op:
  //   there was no prior password to invalidate from), so the existing JWT
  //   stays valid and the user keeps working without re-authentication.
  const setPasswordMut = (api as any).webUsers.setInitialPassword.useMutation({
    onSuccess: () => {
      toast.success(sl.success);
      void utils.auth.getMyRole.invalidate();
    },
    onError: (err: { message?: string }) => {
      if (mounted.current) setError(err.message ?? "Failed to set password");
    },
  }) as { mutate: (args: { newPassword: string }) => void; isPending: boolean };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.newPassword !== form.confirmPassword) {
      setError(sl.mismatch);
      return;
    }
    setPasswordMut.mutate({ newPassword: form.newPassword });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">{sl.newPassword}</label>
          <input
            type="password"
            autoComplete="new-password"
            value={form.newPassword}
            onChange={(e) => setForm((prev) => ({ ...prev, newPassword: e.target.value }))}
            className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-amber-500/60 text-slate-900 dark:text-white"
            required
            minLength={12}
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">{sl.confirmPassword}</label>
          <input
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={(e) => setForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
            className={`w-full bg-slate-50 dark:bg-slate-900/70 border rounded-xl px-4 py-3 text-sm outline-none focus:border-amber-500/60 text-slate-900 dark:text-white ${
              error === sl.mismatch ? "border-red-500/60" : "border-slate-200 dark:border-slate-700/50"
            }`}
            required
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={setPasswordMut.isPending}
          className="w-full flex items-center justify-center gap-1.5 bg-amber-500 active:bg-amber-400 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-amber-500/20 disabled:opacity-70 mt-1"
        >
          <Key className="w-4 h-4" />
          {setPasswordMut.isPending ? t("settings.saving", lang) : sl.submit}
        </button>
      </form>
  );
}
