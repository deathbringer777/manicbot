"use client";

import { useState, useTransition, useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Lock, Mail, User, Building2 } from "lucide-react";
import { api } from "~/trpc/react";
import {
  AuthShell,
  authFieldClassName,
  authFieldWithIconsClassName,
  authPrimaryButtonClassName,
  authSecondaryButtonClassName,
} from "~/components/auth/AuthShell";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"tenant_owner" | "master">("tenant_owner");
  const [referralSource, setReferralSource] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [hasGoogle, setHasGoogle] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const { status } = useSession();

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
      setError("Не удалось начать вход через Google");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Пароли не совпадают");
      return;
    }
    if (password.length < 12) {
      setError("Пароль должен содержать минимум 12 символов");
      return;
    }

    startTransition(async () => {
      try {
        await registerMutation.mutateAsync({
          email: email.trim().toLowerCase(),
          password,
          role,
          name: name.trim() || undefined,
          referralSource: referralSource || undefined,
        });

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
        if (msg.includes("already exists")) {
          setError("Пользователь с таким email уже существует");
        } else {
          setError(msg || "Ошибка регистрации");
        }
      }
    });
  }

  return (
    <AuthShell
      badge="Create Workspace"
      title="Регистрация в том же визуальном ритме, что и лендинг, без ощущения отдельного сервиса."
      description="Создайте кабинет для салона или мастера, а дальше уже подключайте каналы, календарь и публичную страницу. Экран собран так, чтобы и на телефоне, и на ноутбуке он ощущался аккуратно и живо."
      panelTitle="Создать кабинет"
      panelDescription="Заполните базовые данные, выберите роль и продолжайте настройку без лишних шагов."
      footer={
        <p className="text-center text-sm">
          Уже есть аккаунт?{" "}
          <Link href="/login" className="font-medium text-cyan-200 transition hover:text-white">
            Войти
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-medium text-slate-200">Email</label>
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

          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-medium text-slate-200">Роль</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setRole("tenant_owner")}
                className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                  role === "tenant_owner"
                    ? "border-cyan-300/30 bg-cyan-400/12 text-cyan-100"
                    : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
                }`}
              >
                Владелец салона
              </button>
              <button
                type="button"
                onClick={() => setRole("master")}
                className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                  role === "master"
                    ? "border-cyan-300/30 bg-cyan-400/12 text-cyan-100"
                    : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
                }`}
              >
                Мастер
              </button>
            </div>
          </div>

          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-medium text-slate-200">
              {role === "tenant_owner" ? "Название салона" : "Ваше имя"}
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
                placeholder={role === "tenant_owner" ? "Beauty Studio" : "Анна Иванова"}
                className={authFieldWithIconsClassName}
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-200">
              Пароль <span className="font-normal text-slate-400">(мин. 12 символов)</span>
            </label>
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
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-slate-200"
                aria-label={showPwd ? "Скрыть пароль" : "Показать пароль"}
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-200">Подтверждение пароля</label>
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
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-slate-200"
                aria-label={showConfirm ? "Скрыть пароль" : "Показать пароль"}
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-medium text-slate-200">Где узнали о нас?</label>
            <select
              value={referralSource}
              onChange={(e) => setReferralSource(e.target.value)}
              className={`${authFieldClassName} appearance-none`}
            >
              <option value="">Выберите источник</option>
              <option value="google">Google</option>
              <option value="instagram">Instagram</option>
              <option value="telegram">Telegram</option>
              <option value="friends">Друзья / знакомые</option>
              <option value="other">Другое</option>
            </select>
          </div>
        </div>

        {error && (
          <p className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className={authPrimaryButtonClassName}
        >
          {isPending ? "Регистрация..." : "Зарегистрироваться"}
        </button>
      </form>

      {hasGoogle && (
        <>
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs uppercase tracking-[0.24em] text-slate-400">или</span>
            <div className="h-px flex-1 bg-white/10" />
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
            {googleLoading ? "Перенаправление..." : "Войти через Google"}
          </button>
        </>
      )}
    </AuthShell>
  );
}
