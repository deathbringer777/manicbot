"use client";

/**
 * Invited-master registration page (Scenario B of salon.sendMasterInvitation).
 *
 * Flow:
 *  - Email link arrives as /register/invite/<token>.
 *  - Page calls webUsers.getInvitationPreview to verify the token + pull
 *    the inviter's salon name + the locked email.
 *  - Form collects only name + password (email is pre-filled + read-only).
 *  - Submit calls webUsers.acceptInvitationByToken; on success the server
 *    returns a one-time loginToken which we exchange for a NextAuth session
 *    via the existing email/password sign-in path (same pattern as the
 *    verify-email auto-login). Then redirects to the new tenant's dashboard.
 *
 * Failure modes:
 *  - Token invalid / expired / consumed → "invitation_invalid" banner.
 *  - Email already registered (race with manual registration after the
 *    invite was sent) → "email_already_registered" banner with a hint to
 *    log in normally.
 */

import { use, useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Lock, User, Mail, Loader2 } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { api } from "~/trpc/react";
import {
  AuthShell,
  authFieldClassName,
  authFieldWithIconsClassName,
  authPrimaryButtonClassName,
} from "~/components/auth/AuthShell";
import { authCopy } from "~/components/auth/copy";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default function InvitedRegisterPage({ params }: PageProps) {
  const { token } = use(params);
  const router = useRouter();
  const { lang } = useLang();
  const shared = authCopy[lang];
  const { status } = useSession();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const preview = api.webUsers.getInvitationPreview.useQuery({ token }, { retry: false });
  const accept = api.webUsers.acceptInvitationByToken.useMutation();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/dashboard");
    }
  }, [status, router]);

  const labels = (() => {
    switch (lang) {
      case "ru":
        return {
          title: "Регистрация мастера",
          inviteFrom: "приглашает вас в команду",
          name: "Ваше имя",
          submit: "Принять и зарегистрироваться",
          loading: "Проверяем приглашение…",
          invalid: "Приглашение недействительно или истекло. Попросите у салона новое.",
          conflict: "Аккаунт на этот email уже существует. Войдите обычным способом.",
          backToLogin: "Войти существующим аккаунтом",
        };
      case "ua":
        return {
          title: "Реєстрація майстра",
          inviteFrom: "запрошує вас у команду",
          name: "Ваше імʼя",
          submit: "Прийняти і зареєструватися",
          loading: "Перевіряємо запрошення…",
          invalid: "Запрошення недійсне або прострочене. Попросіть у салону нове.",
          conflict: "Акаунт на цей email вже існує. Увійдіть звичайним способом.",
          backToLogin: "Увійти існуючим акаунтом",
        };
      case "pl":
        return {
          title: "Rejestracja mistrza",
          inviteFrom: "zaprasza Cię do zespołu",
          name: "Twoje imię",
          submit: "Zaakceptuj i zarejestruj się",
          loading: "Sprawdzamy zaproszenie…",
          invalid: "Zaproszenie jest nieprawidłowe lub wygasło. Poproś salon o nowe.",
          conflict: "Konto na ten email już istnieje. Zaloguj się normalnie.",
          backToLogin: "Zaloguj się istniejącym kontem",
        };
      default:
        return {
          title: "Master registration",
          inviteFrom: "invited you to join their team",
          name: "Your name",
          submit: "Accept and register",
          loading: "Verifying invitation…",
          invalid: "This invitation is invalid or expired. Ask the salon to resend it.",
          conflict: "An account with this email already exists. Sign in instead.",
          backToLogin: "Sign in with existing account",
        };
    }
  })();

  if (preview.isLoading) {
    return (
      <AuthShell
        eyebrow={shared.register.kicker}
        title={labels.title}
        description=""
        panelTitle={shared.register.panelTitle}
        panelDescription={shared.register.panelDescription}
        footer={null}
      >
        <div className="flex items-center justify-center py-12 text-slate-500 dark:text-slate-400 gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">{labels.loading}</span>
        </div>
      </AuthShell>
    );
  }

  if (!preview.data) {
    return (
      <AuthShell
        eyebrow={shared.register.kicker}
        title={labels.title}
        description=""
        panelTitle={shared.register.panelTitle}
        panelDescription={shared.register.panelDescription}
        footer={null}
      >
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
          {labels.invalid}
        </div>
        <Link href="/login" className={`${authSecondaryLinkClass()} mt-4 block text-center`}>
          {labels.backToLogin}
        </Link>
      </AuthShell>
    );
  }

  // TS narrowing: after the !preview.data early return above, preview.data
  // is non-null for the rest of the component. Hoist it so the JSX below
  // doesn't have to defend.
  const previewData = preview.data;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!password || password.length < 12) {
      setError(shared.shared.passwordRequired);
      return;
    }
    if (password !== confirmPassword) {
      setError(shared.register.passwordsMismatch);
      return;
    }
    if (!name.trim()) {
      setError(labels.name);
      return;
    }
    setSubmitting(true);
    try {
      const result = await accept.mutateAsync({
        token,
        password,
        name: name.trim(),
        lang,
      });
      // Auto-login by exchanging the password (we just set it) for a session.
      // The one-time loginToken returned here is informational; reusing the
      // standard credentials provider keeps the session shape consistent with
      // every other entry point.
      const signInResult = await signIn("credentials", {
        email: previewData.email,
        password,
        redirect: false,
      });
      if (signInResult?.error) {
        setError(shared.login.invalidCredentials);
        setSubmitting(false);
        return;
      }
      // Land in the new tenant's dashboard.
      router.replace(`/dashboard?tab=overview&tenant=${encodeURIComponent(result.tenantId)}`);
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? "";
      if (msg === "email_already_registered") setError(labels.conflict);
      else if (msg === "invitation_invalid") setError(labels.invalid);
      else setError(msg || labels.invalid);
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      eyebrow={shared.register.kicker}
      title={labels.title}
      description={`${previewData.salonName} ${labels.inviteFrom}`}
      panelTitle={shared.register.panelTitle}
      panelDescription={shared.register.panelDescription}
      footer={null}
    >
      <div className="mb-4 rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 text-sm text-violet-700 dark:text-violet-300">
        <strong className="font-semibold">{previewData.salonName}</strong> {labels.inviteFrom}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="email"
            value={previewData.email}
            readOnly
            className={`${authFieldWithIconsClassName} opacity-70 cursor-not-allowed`}
          />
        </div>

        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={labels.name}
            className={authFieldWithIconsClassName}
            required
            maxLength={200}
          />
        </div>

        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type={showPwd ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={shared.register.password}
            className={authFieldWithIconsClassName}
            required
            minLength={12}
            autoComplete="new-password"
          />
          <button
            type="button"
            onClick={() => setShowPwd((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
          >
            {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type={showConfirm ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={shared.register.password}
            className={authFieldWithIconsClassName}
            required
            minLength={12}
            autoComplete="new-password"
          />
          <button
            type="button"
            onClick={() => setShowConfirm((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
          >
            {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <button type="submit" disabled={submitting} className={authPrimaryButtonClassName}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {labels.submit}
        </button>
      </form>
    </AuthShell>
  );
}

function authSecondaryLinkClass(): string {
  return "text-sm text-violet-600 hover:text-violet-500 dark:text-violet-400 dark:hover:text-violet-300 underline";
}
