"use client";

import { useState } from "react";
import { User, Mail, Key, CheckCircle, Save } from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { friendlyRoleName } from "~/lib/roleLabels";

export function AccountSection() {
  const { role, previewRole } = useRole();
  const { lang } = useLang();
  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;

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

  return (
    <div className="space-y-4">
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
