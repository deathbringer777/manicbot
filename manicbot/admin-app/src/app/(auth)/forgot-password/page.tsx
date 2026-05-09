"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Mail, ArrowRight } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { api } from "~/trpc/react";
import {
  AuthShell,
  authFieldWithIconsClassName,
  authPrimaryButtonClassName,
} from "~/components/auth/AuthShell";
import { authCopy } from "~/components/auth/copy";

export default function ForgotPasswordPage() {
  const { lang } = useLang();
  const copy = authCopy[lang];
  const f = copy.forgotPassword;
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  const mutation = api.webUsers.requestPasswordReset.useMutation();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const emailVal = email.trim();
    if (!emailVal) { setError(copy.shared.emailRequired); return; }
    if (!emailVal.includes("@") || emailVal.indexOf("@") === emailVal.length - 1) {
      setError(copy.shared.emailInvalid); return;
    }
    startTransition(async () => {
      try {
        await mutation.mutateAsync({ email: email.trim().toLowerCase() });
        setDone(true);
      } catch {
        setError(f.error);
      }
    });
  }

  return (
    <AuthShell
      eyebrow={f.kicker}
      title={f.title}
      description={f.description}
      panelTitle={f.panelTitle}
      panelDescription={f.panelDescription}
      footer={
        <p className="text-center text-sm">
          <Link
            href="/login"
            className="font-medium text-cyan-700 transition hover:text-slate-900 dark:text-cyan-200 dark:hover:text-white"
          >
            {f.backLogin}
          </Link>
        </p>
      }
    >
      {done ? (
        <div className="space-y-3">
          <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
            {f.done}
          </p>
          <Link
            href={`/reset-password?email=${encodeURIComponent(email.trim().toLowerCase())}`}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300 bg-cyan-50 px-4 py-3 text-sm font-medium text-cyan-800 transition hover:bg-cyan-100 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-100 dark:hover:bg-cyan-500/20"
          >
            {copy.resetPassword.submit} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
              {f.email}
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="salon@example.com"
                className={authFieldWithIconsClassName}
              />
            </div>
          </div>
          {error && (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-200">
              {error}
            </p>
          )}
          <button type="submit" disabled={isPending} className={authPrimaryButtonClassName}>
            {isPending ? f.submitting : f.submit}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
