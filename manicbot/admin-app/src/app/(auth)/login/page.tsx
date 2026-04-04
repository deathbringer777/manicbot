"use client";

import { useState, useTransition, useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useLang } from "~/components/LangContext";
import {
  AuthShell,
  authFieldWithIconsClassName,
  authPrimaryButtonClassName,
  authSecondaryButtonClassName,
} from "~/components/auth/AuthShell";
import { authCopy } from "~/components/auth/copy";

export default function LoginPage() {
  const router = useRouter();
  const { lang } = useLang();
  const copy = authCopy[lang];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [hasGoogle, setHasGoogle] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const { status } = useSession();

  // Redirect already-authenticated users to dashboard
  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/dashboard");
    }
  }, [status, router]);

  // Check if Google provider is configured (direct fetch, no SessionProvider dependency)
  useEffect(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((p: Record<string, unknown>) => {
        if (p?.google) setHasGoogle(true);
      })
      .catch(() => {});
  }, []);

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    try {
      // Fetch CSRF token, then POST form directly (works through proxy)
      const csrf = await fetch("/api/auth/csrf").then((r) => r.json());
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/api/auth/signin/google";
      const csrfInput = document.createElement("input");
      csrfInput.type = "hidden";
      csrfInput.name = "csrfToken";
      csrfInput.value = csrf.csrfToken;
      form.appendChild(csrfInput);
      const cbInput = document.createElement("input");
      cbInput.type = "hidden";
      cbInput.name = "callbackUrl";
      cbInput.value = "/dashboard";
      form.appendChild(cbInput);
      document.body.appendChild(form);
      form.submit();
    } catch {
      setGoogleLoading(false);
      setError(copy.login.googleStartError);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });
      if (result?.error) {
        setError(copy.login.invalidCredentials);
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    });
  }

  return (
    <AuthShell
      eyebrow={copy.login.kicker}
      title={copy.login.title}
      description={copy.login.description}
      panelTitle={copy.login.panelTitle}
      panelDescription={copy.login.panelDescription}
      footer={
        <p className="text-center text-sm">
          {copy.login.noAccount}{" "}
          <Link href="/register" className="font-medium text-cyan-700 transition hover:text-slate-900 dark:text-cyan-200 dark:hover:text-white">
            {copy.login.register}
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
            {copy.login.email}
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

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
            {copy.login.password}
          </label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type={showPwd ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={authFieldWithIconsClassName}
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
              aria-label={showPwd ? copy.login.hidePassword : copy.login.showPassword}
            >
              {showPwd ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {error && (
          <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className={authPrimaryButtonClassName}
        >
          {isPending ? copy.login.submitting : copy.login.submit}
        </button>
      </form>

      {hasGoogle && (
        <>
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
            <span className="text-xs uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">{copy.shared.or}</span>
            <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
          </div>

          <button
            type="button"
            disabled={googleLoading}
            onClick={handleGoogleSignIn}
            className={authSecondaryButtonClassName}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            {googleLoading ? copy.login.googleLoading : copy.login.google}
          </button>
        </>
      )}
    </AuthShell>
  );
}
