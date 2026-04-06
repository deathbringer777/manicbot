"use client";

import { useState, useRef } from "react";
import { User, Mail, Key, CheckCircle, Save, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { friendlyRoleName } from "~/lib/roleLabels";
import type { Lang } from "~/lib/i18n";

const VERIFY_L: Record<Lang, {
  verified: string;
  notVerified: string;
  enterCode: string;
  verify: string;
  resend: string;
  resendCooldown: string;
  success: string;
}> = {
  ru: {
    verified: "Email подтверждён",
    notVerified: "Email не подтверждён",
    enterCode: "Введите 6-значный код из письма",
    verify: "Подтвердить",
    resend: "Отправить код повторно",
    resendCooldown: "Код отправлен",
    success: "Email успешно подтверждён!",
  },
  ua: {
    verified: "Email підтверджено",
    notVerified: "Email не підтверджено",
    enterCode: "Введіть 6-значний код з листа",
    verify: "Підтвердити",
    resend: "Надіслати код повторно",
    resendCooldown: "Код надіслано",
    success: "Email успішно підтверджено!",
  },
  en: {
    verified: "Email verified",
    notVerified: "Email not verified",
    enterCode: "Enter the 6-digit code from your email",
    verify: "Verify",
    resend: "Resend code",
    resendCooldown: "Code sent",
    success: "Email verified successfully!",
  },
  pl: {
    verified: "Email potwierdzony",
    notVerified: "Email nie potwierdzony",
    enterCode: "Wpisz 6-cyfrowy kod z emaila",
    verify: "Potwierdź",
    resend: "Wyślij kod ponownie",
    resendCooldown: "Kod wysłany",
    success: "Email potwierdzony pomyślnie!",
  },
};

export function AccountSection() {
  const { role, previewRole, emailVerified } = useRole();
  const { lang } = useLang();
  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  const vl = VERIFY_L[lang];
  const utils = api.useUtils();

  // Verification code
  const [code, setCode] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifySuccess, setVerifySuccess] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const verifyMut = (api as any).webUsers.verifyEmail.useMutation({
    onSuccess: () => {
      setVerifySuccess(true);
      setVerifyError(null);
      setCode("");
      utils.auth.getMyRole.invalidate();
    },
    onError: (err: { message?: string }) => {
      setVerifyError(err.message ?? "Verification failed");
    },
  }) as { mutate: (args: { email: string; code: string }) => void; isPending: boolean };

  const resendMut = (api as any).webUsers.resendVerificationCode.useMutation({
    onSuccess: () => {
      setResendCooldown(true);
      setTimeout(() => setResendCooldown(false), 60000);
    },
    onError: (err: { message?: string }) => {
      setVerifyError(err.message ?? "Failed to resend code");
    },
  }) as { mutate: (args: { email: string }) => void; isPending: boolean };

  // Get user email from role query for verification calls
  const roleQuery = api.auth.getMyRole.useQuery();
  const sessionEmail = (roleQuery.data as any)?.email ?? "";

  // Change password
  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  const changePasswordMut = (api as any).webUsers.changePassword.useMutation({
    onSuccess: () => {
      setPwSuccess(true);
      setPwError(null);
      setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setTimeout(() => setPwSuccess(false), 3000);
    },
    onError: (err: { message?: string }) => {
      setPwError(err.message ?? t("settings.passwordError", lang));
    },
  }) as { mutate: (args: { currentPassword: string; newPassword: string }) => void; isPending: boolean };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError(t("settings.passwordMismatch", lang));
      return;
    }
    changePasswordMut.mutate({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword });
  };

  // Change email
  const [emailForm, setEmailForm] = useState({ newEmail: "" });
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState(false);

  const changeEmailMut = (api as any).webUsers.requestEmailChange.useMutation({
    onSuccess: () => {
      setEmailSuccess(true);
      setEmailError(null);
      setEmailForm({ newEmail: "" });
      setTimeout(() => setEmailSuccess(false), 5000);
    },
    onError: (err: { message?: string }) => {
      setEmailError(err.message ?? t("settings.emailChangeError", lang));
    },
  }) as { mutate: (args: { newEmail: string }) => void; isPending: boolean };

  const handleChangeEmail = (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);
    changeEmailMut.mutate({ newEmail: emailForm.newEmail });
  };

  const handleVerifyCode = (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyError(null);
    if (code.length !== 6) return;
    verifyMut.mutate({ email: sessionEmail, code });
  };

  return (
    <div className="space-y-4">
      {/* Email verification status */}
      <section className={`glass-card rounded-2xl p-4 border ${
        emailVerified
          ? "border-emerald-500/20"
          : "border-red-500/20"
      }`}>
        <div className="flex items-center gap-3">
          {emailVerified ? (
            <div className="h-10 w-10 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
            </div>
          ) : (
            <div className="h-10 w-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
              <ShieldAlert className="h-5 w-5 text-red-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-bold ${
              emailVerified ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
            }`}>
              {emailVerified ? vl.verified : vl.notVerified}
            </p>
            {!emailVerified && !verifySuccess && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{vl.enterCode}</p>
            )}
          </div>
        </div>

        {!emailVerified && !verifySuccess && (
          <form onSubmit={handleVerifyCode} className="mt-4 space-y-3">
            <div className="flex gap-2">
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
                className="flex-1 bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-center text-lg font-mono tracking-[0.3em] outline-none focus:border-brand-500/60 text-slate-900 dark:text-white"
              />
            </div>
            {verifyError && <p className="text-xs text-red-400">{verifyError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={code.length !== 6 || verifyMut.isPending}
                className="flex-1 flex items-center justify-center gap-1.5 bg-brand-600 active:bg-brand-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all disabled:opacity-50"
              >
                {verifyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : vl.verify}
              </button>
              <button
                type="button"
                onClick={() => resendMut.mutate({ email: sessionEmail })}
                disabled={resendMut.isPending || resendCooldown}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600/60 text-xs font-medium text-slate-600 dark:text-slate-400 hover:border-brand-500/40 transition-colors disabled:opacity-50"
              >
                {resendMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : resendCooldown ? vl.resendCooldown : vl.resend}
              </button>
            </div>
          </form>
        )}

        {verifySuccess && (
          <p className="text-xs text-emerald-400 flex items-center gap-1 mt-3">
            <CheckCircle className="w-3.5 h-3.5" />
            {vl.success}
          </p>
        )}
      </section>

      {/* Account info */}
      <section className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <User className="w-4 h-4 text-brand-400 shrink-0" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t("settings.account", lang)}</h2>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
              {t("settings.role", lang)}
            </label>
            <input
              type="text"
              readOnly
              value={friendlyRoleName(effectiveRole, lang)}
              className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm text-slate-500 dark:text-slate-400 outline-none cursor-default select-none"
            />
          </div>
        </div>
      </section>

      {/* Change email */}
      <section className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <Mail className="w-4 h-4 text-cyan-400 shrink-0" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t("settings.changeEmail", lang)}</h2>
        </div>
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
          {emailSuccess && (
            <p className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5" />
              {t("settings.emailChangeSent", lang)}
            </p>
          )}
          <button
            type="submit"
            disabled={changeEmailMut.isPending}
            className="w-full flex items-center justify-center gap-1.5 bg-cyan-600 active:bg-cyan-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-70 mt-1"
          >
            <Mail className="w-4 h-4" />
            {changeEmailMut.isPending ? t("settings.saving", lang) : t("settings.changeEmailBtn", lang)}
          </button>
        </form>
      </section>

      {/* Change password */}
      <section className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <Key className="w-4 h-4 text-amber-400 shrink-0" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t("settings.changePassword", lang)}</h2>
        </div>
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
          {pwSuccess && (
            <p className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5" />
              {t("settings.passwordChangedOk", lang)}
            </p>
          )}
          <button
            type="submit"
            disabled={changePasswordMut.isPending}
            className="w-full flex items-center justify-center gap-1.5 bg-brand-600 active:bg-brand-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-brand-500/20 disabled:opacity-70 mt-1"
          >
            <Save className="w-4 h-4" />
            {changePasswordMut.isPending ? t("settings.saving", lang) : t("settings.changePasswordBtn", lang)}
          </button>
        </form>
      </section>
    </div>
  );
}
