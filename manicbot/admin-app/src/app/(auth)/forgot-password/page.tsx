"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
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
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
          {f.done}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
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
