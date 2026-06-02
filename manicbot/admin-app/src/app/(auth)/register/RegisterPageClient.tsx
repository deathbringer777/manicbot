"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Lock, Mail, User, Building2 } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { api } from "~/trpc/react";
import {
  AuthShell,
  authFieldClassName,
  authFieldWithIconsClassName,
  authPrimaryButtonClassName,
  authSecondaryButtonClassName,
} from "~/components/auth/AuthShell";
import { authCopy } from "~/components/auth/copy";
import { ReferralSourceSelect } from "~/components/auth/ReferralSourceSelect";
import { t as tr } from "~/lib/i18n";

/**
 * Client-side mirror of the server-side `isSafeDisplayName` predicate
 * in `~/server/security/sanitize.ts`. Kept in lockstep with the server
 * — any change here MUST be reflected there and vice versa.
 *
 * Blocks names that contain HTML metacharacters, CRLF, leading RTL
 * override, zero-width chars, or control bytes — the same set the
 * email-template sanitizer would silently strip.
 */
function isSafeDisplayNameClient(input: string): boolean {
  if (input.length === 0) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(input)) return false;
  if (/[<>&"]/.test(input)) return false;
  if (/[​-‍﻿]/.test(input)) return false;
  if (/^[‪-‮⁦-⁩‎‏]/.test(input)) return false;
  return true;
}

export default function RegisterPageClient() {
  const router = useRouter();
  const { lang } = useLang();
  const copy = authCopy[lang];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  // Blocker 4 — inline validation against `isSafeDisplayNameClient`.
  // Computed each render (cheap, regex-based); shown below the input.
  // The submit handler also re-checks before firing the mutation so the
  // user can't bypass via dev-tools-disabled aria-invalid styling.
  const nameValidationError =
    name.length > 0 && !isSafeDisplayNameClient(name)
      ? tr("auth.errors.nameContainsForbiddenChars", lang)
      : null;
  const [role, setRole] = useState<"tenant_owner" | "master">("tenant_owner");
  const [referralSource, setReferralSource] = useState<"google" | "instagram" | "telegram" | "friends" | "other" | "">("");
  const [referralNote, setReferralNote] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [referralCodeLocked, setReferralCodeLocked] = useState(false);
  const [tosAccepted, setTosAccepted] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [hasGoogle, setHasGoogle] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googlePrefillToken, setGooglePrefillToken] = useState<string | null>(null);
  const [emailFromGoogleLocked, setEmailFromGoogleLocked] = useState(false);
  const prefillAppliedRef = useRef(false);
  const { status } = useSession();

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const g = sp.get("g");
      if (g) setGooglePrefillToken(g);
      const ref = sp.get("ref");
      if (ref) {
        const normalized = ref.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16);
        if (normalized.length >= 6) {
          setReferralCode(normalized);
          setReferralCodeLocked(true);
          setReferralSource("friends");
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Live validation against the referrals router. Only fires once the code
  // is in valid shape; cheap enough to run on every keystroke (server is
  // rate-limited 10/min/IP).
  const codeValidation = api.referrals.validateCode.useQuery(
    { code: referralCode },
    {
      enabled: /^[A-Z0-9-]{6,16}$/.test(referralCode) && referralSource === "friends",
      retry: false,
      staleTime: 60 * 1000,
    },
  );

  const prefillQuery = api.webUsers.googlePrefillPreview.useQuery(
    { token: googlePrefillToken! },
    { enabled: Boolean(googlePrefillToken), retry: false },
  );

  useEffect(() => {
    if (prefillAppliedRef.current || !prefillQuery.data?.ok || !googlePrefillToken) return;
    prefillAppliedRef.current = true;
    setEmail(prefillQuery.data.email);
    if (prefillQuery.data.name) setName(prefillQuery.data.name);
    setEmailFromGoogleLocked(true);
    setReferralSource((s) => s || "google");
  }, [prefillQuery.data, googlePrefillToken]);

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/dashboard");
    }
  }, [status, router]);

  useEffect(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((p: Record<string, unknown>) => {
        if (p?.google) setHasGoogle(true);
      })
      .catch(() => {});
  }, []);

  const registerMutation = api.webUsers.register.useMutation();

  async function handleGoogleSignIn() {
    if (!tosAccepted) {
      setError(copy.register.tosRequired);
      return;
    }
    setGoogleLoading(true);
    try {
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
      setError(copy.register.googleStartError);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsConflict(false);
    setSuccessMessage(null);

    const emailVal = email.trim();
    if (!emailVal) { setError(copy.shared.emailRequired); return; }
    if (!emailVal.includes("@") || emailVal.indexOf("@") === emailVal.length - 1) {
      setError(copy.shared.emailInvalid); return;
    }
    // Password is required unless Google prefill is active
    if (!emailFromGoogleLocked) {
      if (!password) { setError(copy.shared.passwordRequired); return; }
      if (password !== confirmPassword) {
        setError(copy.register.passwordsMismatch);
        return;
      }
      if (password.length < 12) {
        setError(copy.register.passwordTooShort);
        return;
      }
    }
    if (!tosAccepted) {
      setError(copy.register.tosRequired);
      return;
    }
    if (nameValidationError) {
      setError(nameValidationError);
      return;
    }

    startTransition(async () => {
      try {
        const registration = await registerMutation.mutateAsync({
          email: email.trim().toLowerCase(),
          password: password || undefined,
          role,
          name: name.trim() || undefined,
          lang,
          referralSource: referralSource || undefined,
          referralNote: (referralSource === "other" && referralNote.trim()) ? referralNote.trim() : undefined,
          referralCode:
            referralSource === "friends" && /^[A-Z0-9-]{6,16}$/.test(referralCode)
              ? referralCode
              : undefined,
          tosAccepted: true as const,
          googlePrefillToken:
            emailFromGoogleLocked && googlePrefillToken ? googlePrefillToken : undefined,
        });

        if (registration.verificationRequired) {
          // #P1-6 — never stash the password in sessionStorage. The verify-email
          // page exchanges a server-issued one-time login token for a session
          // (see webUsers.verifyEmail and the credentials provider), so the
          // plaintext password no longer lives in JS-accessible storage.
          router.push(`/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`);
          return;
        }

        const result = await signIn("credentials", {
          email: email.trim().toLowerCase(),
          password,
          redirect: false,
        });
        if (result?.error) {
          router.push("/login");
        } else {
          router.push("/dashboard");
          router.refresh();
        }
      } catch (err: any) {
        const msg = err?.message ?? "";
        if (msg.includes("already exists") || msg.includes("Registration failed")) {
          setIsConflict(true);
          setError(copy.register.conflict);
        } else if (msg.includes("invalid_type") || msg.includes("Expected")) {
          setError(copy.register.registrationError);
        } else {
          setError(msg || copy.register.registrationError);
        }
      }
    });
  }

  return (
    <AuthShell
      eyebrow={copy.register.kicker}
      title={copy.register.title}
      description={copy.register.description}
      panelTitle={copy.register.panelTitle}
      panelDescription={copy.register.panelDescription}
      footer={
        <p className="text-center text-sm">
          {copy.register.hasAccount}{" "}
          <Link href="/login" className="font-medium text-cyan-700 transition hover:text-slate-900 dark:text-cyan-200 dark:hover:text-white">
            {copy.register.login}
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {googlePrefillToken && prefillQuery.isFetched && prefillQuery.data && !prefillQuery.data.ok && (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-100">
            {copy.register.googlePrefillExpired}
          </p>
        )}

        {emailFromGoogleLocked && prefillQuery.data?.ok && (
          <p className="rounded-2xl border border-cyan-200/50 bg-cyan-50/80 px-4 py-3 text-sm text-cyan-900 dark:border-cyan-400/20 dark:bg-cyan-500/10 dark:text-cyan-100">
            {copy.register.googlePrefillHint}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">{copy.register.role}</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setRole("tenant_owner")}
                className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                  role === "tenant_owner"
                    ? "border-cyan-300/40 bg-cyan-50 text-cyan-700 dark:border-cyan-300/30 dark:bg-cyan-400/12 dark:text-cyan-100"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08]"
                }`}
              >
                {copy.register.roleOwner}
              </button>
              <button
                type="button"
                onClick={() => setRole("master")}
                className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                  role === "master"
                    ? "border-cyan-300/40 bg-cyan-50 text-cyan-700 dark:border-cyan-300/30 dark:bg-cyan-400/12 dark:text-cyan-100"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08]"
                }`}
              >
                {copy.register.roleMaster}
              </button>
            </div>
          </div>

          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">{copy.login.email}</label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={emailFromGoogleLocked}
                placeholder="salon@example.com"
                className={`${authFieldWithIconsClassName}${emailFromGoogleLocked ? " opacity-90" : ""}`}
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
              {role === "tenant_owner" ? copy.register.salonName : copy.register.yourName}
            </label>
            <div className="relative">
              {role === "tenant_owner" ? (
                <Building2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              ) : (
                <User className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              )}
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={role === "tenant_owner" ? "Beauty Studio" : "Anna Ivanova"}
                className={authFieldWithIconsClassName}
                aria-invalid={nameValidationError ? "true" : undefined}
              />
            </div>
            {nameValidationError && (
              <p className="mt-1.5 text-xs text-red-500" role="alert">
                {nameValidationError}
              </p>
            )}
          </div>

          {!emailFromGoogleLocked && (
            <>
              <div>
                <div className="mb-2 min-h-[3rem]">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">{copy.register.password}</label>
                  <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{copy.register.passwordHint}</p>
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type={showPwd ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className={authFieldWithIconsClassName}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
                    aria-label={showPwd ? copy.register.hidePassword : copy.register.showPassword}
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-2 min-h-[3rem]">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">{copy.register.confirmPassword}</label>
                  <p className="invisible mt-0.5 text-xs" aria-hidden>
                    {copy.register.passwordHint}
                  </p>
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type={showConfirm ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className={authFieldWithIconsClassName}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
                    aria-label={showConfirm ? copy.register.hidePassword : copy.register.showPassword}
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </>
          )}

          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">{copy.register.referral}</label>
            <ReferralSourceSelect
              value={referralSource}
              note={referralNote}
              onChange={(v) => {
                setReferralSource(v);
                if (v !== "friends" && !referralCodeLocked) setReferralCode("");
              }}
              onNoteChange={setReferralNote}
              copy={copy.register}
            />
            {referralSource === "friends" && (
              <div className="mt-3 space-y-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                  {copy.register.referralCodeLabel}
                </label>
                <input
                  type="text"
                  value={referralCode}
                  onChange={(e) =>
                    setReferralCode(
                      e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16),
                    )
                  }
                  readOnly={referralCodeLocked}
                  placeholder={copy.register.referralCodePlaceholder}
                  className={authFieldClassName}
                  autoComplete="off"
                />
                {referralCode && /^[A-Z0-9-]{6,16}$/.test(referralCode) && codeValidation.data && (
                  codeValidation.data.valid ? (
                    <p className="rounded-xl border border-emerald-200/60 bg-emerald-50/80 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-200">
                      {codeValidation.data.kind === "service_grant"
                        ? copy.register.referralCodeServiceGrant
                        : copy.register.referralCodeValid.replace(
                            "{name}",
                            codeValidation.data.ownerDisplayName ?? "—",
                          )}
                    </p>
                  ) : (
                    <p className="rounded-xl border border-amber-200/60 bg-amber-50/80 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-200">
                      {copy.register.referralCodeInvalid}
                    </p>
                  )
                )}
              </div>
            )}
          </div>
        </div>

        {successMessage && (
          <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200">
            {successMessage}
          </p>
        )}

        {error && (
          <div className={`rounded-2xl border px-4 py-3 text-sm ${
            isConflict
              ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-200"
          }`}>
            <p className="font-medium">{error}</p>
            {isConflict && (
              <>
                <p className="mt-1.5 text-xs opacity-80">{copy.register.conflictHint}</p>
                <div className="mt-3 flex gap-3">
                  <Link
                    href="/login"
                    className="inline-flex items-center rounded-lg bg-cyan-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500 dark:bg-cyan-500 dark:hover:bg-cyan-400"
                  >
                    {copy.register.conflictLogin}
                  </Link>
                  <Link
                    href="/forgot-password"
                    className="inline-flex items-center rounded-lg border border-current/20 px-4 py-1.5 text-xs font-medium transition hover:opacity-80"
                  >
                    {copy.register.conflictForgot}
                  </Link>
                </div>
              </>
            )}
          </div>
        )}

        <label className="group flex cursor-pointer items-start gap-3 rounded-2xl border border-cyan-200/40 bg-cyan-50/50 px-4 py-3 transition hover:bg-cyan-50 dark:border-cyan-400/20 dark:bg-cyan-500/5 dark:hover:bg-cyan-500/10">
          <input
            type="checkbox"
            checked={tosAccepted}
            onChange={(e) => setTosAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500 accent-cyan-600 dark:border-white/20 dark:bg-white/5"
          />
          <span className="text-sm text-slate-600 dark:text-slate-300">
            {copy.register.tosLabel}{" "}
            <a
              href="/rules"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-cyan-700 underline decoration-cyan-400/40 hover:text-cyan-500 dark:text-cyan-300 dark:hover:text-cyan-200"
            >
              {copy.register.tosLinkText}
            </a>
          </span>
        </label>

        <button
          type="submit"
          disabled={isPending}
          className={authPrimaryButtonClassName}
        >
          {isPending ? copy.register.submitting : copy.register.submit}
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
            {googleLoading ? copy.register.googleLoading : copy.register.google}
          </button>
        </>
      )}
    </AuthShell>
  );
}
