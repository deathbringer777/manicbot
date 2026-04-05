"use client";

import { Suspense, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Lock } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { api } from "~/trpc/react";
import {
  AuthShell,
  authFieldWithIconsClassName,
  authPrimaryButtonClassName,
} from "~/components/auth/AuthShell";
import { authCopy } from "~/components/auth/copy";

function ResetPasswordInner() {
  const { lang } = useLang();
  const copy = authCopy[lang];
  const r = copy.resetPassword;
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const mutation = api.webUsers.resetPassword.useMutation();

  if (!token) {
    return (
      <AuthShell
        eyebrow={r.kicker}
        title={r.title}
        description={r.description}
        panelTitle={r.panelTitle}
        panelDescription={r.panelDescription}
        footer={
          <p className="text-center text-sm">
            <Link
              href="/login"
              className="font-medium text-cyan-700 transition hover:text-slate-900 dark:text-cyan-200 dark:hover:text-white"
            >
              {r.goLogin}
            </Link>
          </p>
        }
      >
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          {r.missingToken}
        </p>
      </AuthShell>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError(r.passwordHint);
      return;
    }
    if (password !== confirm) {
      setError(r.passwordsMismatch);
      return;
    }
    startTransition(async () => {
      try {
        await mutation.mutateAsync({ token, newPassword: password });
        setSuccess(true);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "";
        setError(msg || r.error);
      }
    });
  }

  return (
    <AuthShell
      eyebrow={r.kicker}
      title={r.title}
      description={r.description}
      panelTitle={r.panelTitle}
      panelDescription={r.panelDescription}
      footer={
        <p className="text-center text-sm">
          <Link
            href="/login"
            className="font-medium text-cyan-700 transition hover:text-slate-900 dark:text-cyan-200 dark:hover:text-white"
          >
            {r.goLogin}
          </Link>
        </p>
      }
    >
      {success ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
          {r.success}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
              {r.newPassword}{" "}
              <span className="font-normal text-slate-400">({r.passwordHint})</span>
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type={showPwd ? "text" : "password"}
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={authFieldWithIconsClassName}
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
                aria-label={showPwd ? r.hidePassword : r.showPassword}
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
              {r.confirmPassword}
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={authFieldWithIconsClassName}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
                aria-label={showConfirm ? r.hidePassword : r.showPassword}
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {error && (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-200">
              {error}
            </p>
          )}
          <button type="submit" disabled={isPending} className={authPrimaryButtonClassName}>
            {isPending ? r.submitting : r.submit}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  const { lang } = useLang();
  const copy = authCopy[lang];
  const r = copy.resetPassword;
  return (
    <Suspense
      fallback={
        <AuthShell
          eyebrow={r.kicker}
          title={r.title}
          description={r.description}
          panelTitle={r.panelTitle}
          panelDescription={r.panelDescription}
          footer={null}
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">…</p>
        </AuthShell>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
