"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useLang } from "~/components/LangContext";
import { api } from "~/trpc/react";
import { AuthShell } from "~/components/auth/AuthShell";
import { authCopy } from "~/components/auth/copy";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN = 60; // seconds

function VerifyEmailInner() {
  const { lang } = useLang();
  const copy = authCopy[lang];
  const v = copy.verifyEmail;
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email")?.trim().toLowerCase() ?? "";

  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [state, setState] = useState<"idle" | "verifying" | "ok" | "okAlready" | "err">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN);
  const [resendSuccess, setResendSuccess] = useState(false);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const { mutateAsync: verify } = api.webUsers.verifyEmail.useMutation();
  const { mutateAsync: resend } = api.webUsers.resendVerificationCode.useMutation();

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  // Auto-submit when all digits filled
  const handleVerify = useCallback(
    async (code: string) => {
      if (code.length !== CODE_LENGTH || !email) return;
      setState("verifying");
      setErrorMsg("");
      try {
        const r = await verify({ email, code });
        if (r.alreadyVerified) {
          setState("okAlready");
        } else {
          setState("ok");
        }
        // Auto-login after successful verification (password stored in sessionStorage by register page)
        let storedPwd = "";
        try {
          storedPwd = sessionStorage.getItem("_vepwd") ?? "";
          sessionStorage.removeItem("_vepwd");
        } catch { /* ignore */ }
        const signInResult = await signIn("credentials", {
          email,
          password: storedPwd,
          redirect: false,
        });
        if (signInResult?.error) {
          setTimeout(() => router.push("/login"), 1500);
        } else {
          setTimeout(() => {
            router.push("/dashboard");
            router.refresh();
          }, 1000);
        }
      } catch (err: any) {
        setState("err");
        const msg = err?.message ?? "";
        if (msg.includes("expired")) {
          setErrorMsg(v.expiredCode);
        } else if (msg.includes("Too many")) {
          setErrorMsg(msg);
        } else {
          setErrorMsg(v.invalidCode);
        }
        // Clear digits on error
        setDigits(Array(CODE_LENGTH).fill(""));
        setTimeout(() => inputRefs.current[0]?.focus(), 100);
      }
    },
    [email, verify, router, v],
  );

  const handleChange = (index: number, value: string) => {
    // Only allow digits
    const digit = value.replace(/\D/g, "").slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);
    setErrorMsg("");

    if (digit && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit if all filled
    const code = newDigits.join("");
    if (code.length === CODE_LENGTH && code.match(/^\d{6}$/)) {
      void handleVerify(code);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      const newDigits = [...digits];
      newDigits[index - 1] = "";
      setDigits(newDigits);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (!pasted) return;
    const newDigits = Array(CODE_LENGTH).fill("");
    for (let i = 0; i < pasted.length; i++) {
      newDigits[i] = pasted[i]!;
    }
    setDigits(newDigits);
    const focusIdx = Math.min(pasted.length, CODE_LENGTH - 1);
    inputRefs.current[focusIdx]?.focus();

    if (pasted.length === CODE_LENGTH) {
      void handleVerify(pasted);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || !email) return;
    try {
      await resend({ email });
      setResendCooldown(RESEND_COOLDOWN);
      setResendSuccess(true);
      setTimeout(() => setResendSuccess(false), 3000);
    } catch {
      // Silent — rate limit already handled on server
    }
  };

  if (!email) {
    return (
      <AuthShell
        eyebrow={v.kicker}
        title={v.title}
        description={v.description}
        panelTitle={v.panelTitle}
        panelDescription={v.panelDescription}
        footer={
          <p className="text-center text-sm">
            <Link href="/login" className="font-medium text-cyan-700 transition hover:text-slate-900 dark:text-cyan-200 dark:hover:text-white">
              {v.goLogin}
            </Link>
          </p>
        }
      >
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          {v.missingToken}
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow={v.kicker}
      title={v.title}
      description={v.description}
      panelTitle={v.panelTitle}
      panelDescription={v.panelDescription}
      footer={
        <div className="flex items-center justify-center gap-3 text-sm">
          <Link href="/register" className="font-medium text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
            {v.backToRegister}
          </Link>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <Link href="/login" className="font-medium text-cyan-700 transition hover:text-slate-900 dark:text-cyan-200 dark:hover:text-white">
            {v.goLogin}
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Email display */}
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">
          {email}
        </p>

        {/* Success state */}
        {(state === "ok" || state === "okAlready") && (
          <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
            {state === "ok" ? v.success : v.successAlready}
          </p>
        )}

        {/* Code input */}
        {state !== "ok" && state !== "okAlready" && (
          <>
            <div className="flex justify-center gap-2" onPaste={handlePaste}>
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  autoFocus={i === 0}
                  disabled={state === "verifying"}
                  className={`h-14 w-11 rounded-xl border text-center text-xl font-bold outline-none transition-all
                    ${state === "err"
                      ? "border-red-500/60 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-200"
                      : "border-slate-200 bg-slate-50 text-slate-900 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-900/70 dark:text-white dark:focus:border-brand-400"
                    }
                    disabled:opacity-50`}
                />
              ))}
            </div>

            {/* Error message */}
            {errorMsg && (
              <p className="text-center text-xs text-red-500 dark:text-red-400">{errorMsg}</p>
            )}

            {/* Verifying spinner */}
            {state === "verifying" && (
              <div className="flex justify-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-500" />
              </div>
            )}

            {/* Resend button */}
            <div className="text-center">
              {resendSuccess ? (
                <p className="text-xs text-emerald-500">{v.resendSuccess}</p>
              ) : resendCooldown > 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {v.resendCooldown} {resendCooldown}s
                </p>
              ) : (
                <button
                  type="button"
                  onClick={handleResend}
                  className="text-xs font-medium text-cyan-600 hover:text-cyan-500 dark:text-cyan-400 dark:hover:text-cyan-300 transition-colors"
                >
                  {v.resendCode}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  const { lang } = useLang();
  const copy = authCopy[lang];
  return (
    <Suspense
      fallback={
        <AuthShell
          eyebrow={copy.verifyEmail.kicker}
          title={copy.verifyEmail.title}
          description={copy.verifyEmail.description}
          panelTitle={copy.verifyEmail.panelTitle}
          panelDescription={copy.verifyEmail.panelDescription}
          footer={null}
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">{copy.verifyEmail.verifying}</p>
        </AuthShell>
      }
    >
      <VerifyEmailInner />
    </Suspense>
  );
}
