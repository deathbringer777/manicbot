"use client";

/**
 * MasterPasswordVaultSection — OTP-gated peek + reset for a salon-created
 * master's login password.
 *
 * Lives inside MasterDetailModal → "Настройки" tab. Only renders for
 * `origin === 'salon_created'` master rows with a linked web_user; for
 * non-salon-owned accounts it shows a short hint instead so the owner
 * understands why the section is read-only.
 *
 * Flow:
 *   1. User picks an action (Show / Reset).
 *   2. Component fires `otp.request` → server emails a 6-digit code to the
 *      OWNER's address (not the master's), writes a hashed row in
 *      global_otp_codes keyed by (webUserId, action, payloadHash).
 *   3. We switch to the code-entry view. User types the code.
 *   4. On submit we call `salon.peekMasterPassword` or
 *      `salon.resetMasterPassword` with the code. Server re-hashes + compares
 *      (timing-safe) and either returns the plaintext (peek) or returns the
 *      masked email (reset).
 *   5. On reveal we render the password with a copy button and a 30s
 *      auto-hide countdown. After hide we drop back to idle.
 */

import { useEffect, useRef, useState } from "react";
import { Eye, KeyRound, Loader2, ShieldCheck, Copy, Check, RotateCcw } from "lucide-react";
import { TRPCClientError } from "@trpc/client";
import { api } from "~/trpc/react";
import { t, type Lang } from "~/lib/i18n";

interface Props {
  tenantId: string;
  masterChatId: number;
  masterName: string | null;
  origin: string;
  webUser: {
    email: string;
    emailVerified: number;
    hasVaultedPassword: boolean;
  } | null;
  lang: Lang;
}

type Phase =
  | { kind: "idle" }
  | { kind: "code"; action: "peek" | "reset"; sentTo: string }
  | { kind: "revealed"; password: string; secondsLeft: number; bootstrapped: boolean }
  | { kind: "resetDone"; emailSentTo: string };

const REVEAL_SECONDS = 30;

function mapOtpError(message: string, lang: Lang): string {
  switch (message) {
    case "otp_required":   return t("otp.error.required", lang);
    case "otp_invalid":    return t("otp.error.invalid", lang);
    case "otp_expired":    return t("otp.error.expired", lang);
    case "otp_exhausted":  return t("otp.error.exhausted", lang);
    case "otp_consumed":   return t("otp.error.consumed", lang);
    case "rate_limited":   return t("otp.error.rateLimited", lang);
    default: return message;
  }
}

export function MasterPasswordVaultSection({
  tenantId,
  masterChatId,
  masterName,
  origin,
  webUser,
  lang,
}: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  // Empty-vault bootstrap warning. Distinct from confirmReset so the two
  // confirm cards don't collide if both buttons are clicked in sequence.
  const [confirmBootstrap, setConfirmBootstrap] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stop the auto-hide ticker when the component unmounts mid-reveal.
  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
  }, []);

  const requestOtp = api.otp.request.useMutation();
  const peek = api.salon.peekMasterPassword.useMutation();
  const reset = api.salon.resetMasterPassword.useMutation();

  // Up-front gating — render placeholder copy when nothing else is meaningful.
  if (origin !== "salon_created") {
    return (
      <SectionCard>
        <Header />
        <p className="text-[12px] text-slate-500 dark:text-slate-400">
          {t("masterDetail.password.notSalonOwned", lang)}
        </p>
      </SectionCard>
    );
  }
  if (!webUser) {
    return (
      <SectionCard>
        <Header />
        <p className="text-[12px] text-slate-500 dark:text-slate-400">
          {t("masterDetail.password.noWebUser", lang)}
        </p>
      </SectionCard>
    );
  }

  const startReveal = (password: string, bootstrapped: boolean) => {
    let secondsLeft = REVEAL_SECONDS;
    setPhase({ kind: "revealed", password, secondsLeft, bootstrapped });
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        if (tickRef.current) clearInterval(tickRef.current);
        tickRef.current = null;
        setPhase({ kind: "idle" });
        setCopied(false);
      } else {
        setPhase({ kind: "revealed", password, secondsLeft, bootstrapped });
      }
    }, 1000);
  };

  const handleRequest = async (action: "peek" | "reset") => {
    setError(null);
    setCode("");
    const actionLabelKey =
      action === "peek"
        ? "masterDetail.password.actionLabel.peek"
        : "masterDetail.password.actionLabel.reset";
    const actionLabel = t(actionLabelKey, lang).replace(
      "{name}",
      masterName ?? `#${masterChatId}`,
    );
    try {
      await requestOtp.mutateAsync({
        action: action === "peek" ? "peek_master_password" : "reset_master_password",
        payload: { tenantId, masterChatId },
        actionLabel,
      });
      setPhase({ kind: "code", action, sentTo: webUser.email });
    } catch (e) {
      const msg = e instanceof TRPCClientError ? e.message : String(e);
      setError(mapOtpError(msg, lang));
    }
  };

  const handleSubmitCode = async () => {
    if (phase.kind !== "code") return;
    setError(null);
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setError(t("otp.error.invalid", lang));
      return;
    }
    try {
      if (phase.action === "peek") {
        const res = await peek.mutateAsync({
          tenantId,
          masterChatId,
          otpCode: trimmed,
        });
        startReveal(res.password, Boolean((res as { bootstrapped?: boolean }).bootstrapped));
      } else {
        const res = await reset.mutateAsync({
          tenantId,
          masterChatId,
          otpCode: trimmed,
        });
        setPhase({ kind: "resetDone", emailSentTo: res.emailSentTo });
        setConfirmReset(false);
      }
      setCode("");
    } catch (e) {
      const msg = e instanceof TRPCClientError ? e.message : String(e);
      setError(mapOtpError(msg, lang));
    }
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable in a non-secure context — fail silently.
    }
  };

  // ── Render phases ────────────────────────────────────────────────────────

  if (phase.kind === "revealed") {
    return (
      <SectionCard>
        <Header />
        {phase.bootstrapped && (
          <div
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300"
            data-testid="master-password-bootstrap-hint"
          >
            {t("masterDetail.password.bootstrappedHint", lang)}
          </div>
        )}
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{t("masterDetail.password.copyHint", lang)}</span>
          </div>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 truncate rounded-md bg-white/80 px-3 py-2 font-mono text-sm tracking-wider text-slate-900 dark:bg-slate-950/60 dark:text-slate-100"
              data-testid="master-password-reveal"
            >
              {phase.password}
            </code>
            <button
              type="button"
              onClick={() => handleCopy(phase.password)}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 px-2.5 py-2 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-500/10 dark:text-emerald-300"
              data-testid="master-password-copy"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? t("masterDetail.password.copied", lang) : t("masterDetail.password.copy", lang)}</span>
            </button>
          </div>
          <p className="mt-2 text-[10px] text-emerald-700/70 dark:text-emerald-300/70">
            {t("masterDetail.password.hideIn", lang).replace("{seconds}", String(phase.secondsLeft))}
          </p>
        </div>
      </SectionCard>
    );
  }

  if (phase.kind === "resetDone") {
    return (
      <SectionCard>
        <Header />
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-[12px] text-emerald-700 dark:text-emerald-300">
          {t("masterDetail.password.resetEmailed", lang).replace("{email}", phase.emailSentTo)}
        </div>
      </SectionCard>
    );
  }

  if (phase.kind === "code") {
    const submitting = peek.isPending || reset.isPending;
    return (
      <SectionCard>
        <Header />
        <p className="text-[12px] text-slate-600 dark:text-slate-300">
          {t("masterDetail.password.codeSentTo", lang).replace("{email}", phase.sentTo)}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder={t("masterDetail.password.enterCode", lang)}
            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-center font-mono text-base tracking-[0.5em] text-slate-900 outline-none focus:border-brand-400 dark:border-white/10 dark:bg-slate-800 dark:text-slate-100"
            data-testid="master-password-otp-input"
          />
          <button
            type="button"
            onClick={() => void handleSubmitCode()}
            disabled={submitting || code.length !== 6}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
            data-testid="master-password-otp-submit"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            <span>{t("masterDetail.password.submit", lang)}</span>
          </button>
        </div>
        {error && (
          <p className="text-[11px] text-rose-600 dark:text-rose-300">{error}</p>
        )}
        <button
          type="button"
          onClick={() => void handleRequest(phase.action)}
          disabled={requestOtp.isPending}
          className="inline-flex items-center gap-1 self-start text-[11px] font-medium text-slate-500 underline-offset-2 hover:underline disabled:opacity-50 dark:text-slate-400"
          data-testid="master-password-otp-resend"
        >
          <RotateCcw className="h-3 w-3" />
          {t("masterDetail.password.resend", lang)}
        </button>
      </SectionCard>
    );
  }

  // idle
  const handleShowClick = () => {
    if (webUser.hasVaultedPassword) {
      void handleRequest("peek");
    } else {
      // Empty vault — the old password is unrecoverable, so we have to
      // generate a new one and rotate. Surface the consequence (active
      // master sessions get signed out) before firing the OTP.
      setConfirmBootstrap(true);
    }
  };

  return (
    <SectionCard>
      <Header />
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {t("masterDetail.password.hint", lang)}
      </p>
      {!webUser.hasVaultedPassword && !confirmBootstrap && (
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300"
          data-testid="master-password-not-vaulted-hint"
        >
          {t("masterDetail.password.notVaulted", lang)}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleShowClick}
          disabled={requestOtp.isPending}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5 sm:flex-initial"
          data-testid="master-password-show"
        >
          {requestOtp.isPending && phase.kind === "idle" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
          <span>{t("masterDetail.password.show", lang)}</span>
        </button>
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          disabled={requestOtp.isPending}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs font-medium text-amber-700 transition hover:bg-amber-500/15 disabled:opacity-50 dark:text-amber-300 sm:flex-initial"
          data-testid="master-password-reset"
        >
          <KeyRound className="h-3.5 w-3.5" />
          <span>{t("masterDetail.password.reset", lang)}</span>
        </button>
      </div>
      {confirmBootstrap && (
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300"
          data-testid="master-password-bootstrap-confirm-card"
        >
          <p className="mb-2">{t("masterDetail.password.confirmBootstrap", lang)}</p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmBootstrap(false)}
              className="flex-1 rounded bg-white px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >
              {t("common.cancel", lang)}
            </button>
            <button
              onClick={() => {
                setConfirmBootstrap(false);
                void handleRequest("peek");
              }}
              className="flex-1 rounded bg-amber-600 px-2 py-1 font-semibold text-white"
              data-testid="master-password-bootstrap-confirm"
            >
              {t("masterDetail.password.confirmBootstrapCta", lang)}
            </button>
          </div>
        </div>
      )}
      {confirmReset && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <p className="mb-2">{t("masterDetail.password.confirmReset", lang)}</p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmReset(false)}
              className="flex-1 rounded bg-white px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >
              {t("common.cancel", lang)}
            </button>
            <button
              onClick={() => void handleRequest("reset")}
              className="flex-1 rounded bg-amber-600 px-2 py-1 font-semibold text-white"
              data-testid="master-password-reset-confirm"
            >
              {t("masterDetail.password.reset", lang)}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="text-[11px] text-rose-600 dark:text-rose-300">{error}</p>
      )}
    </SectionCard>
  );

  function Header() {
    return (
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-purple-500" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {t("masterDetail.password.title", lang)}
        </h3>
      </div>
    );
  }
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.03]"
      data-testid="master-password-vault"
    >
      {children}
    </section>
  );
}
