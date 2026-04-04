"use client";

import { useState, useTransition, useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, Mail, Sparkles, User, Building2 } from "lucide-react";
import { api } from "~/trpc/react";

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
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500/20 ring-1 ring-brand-500/30">
            <Sparkles className="h-8 w-8 text-brand-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">ManicBot</h1>
          <p className="mt-1 text-sm text-slate-400">Регистрация</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl bg-slate-900 p-6 ring-1 ring-slate-800">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="salon@example.com"
                  className="w-full rounded-lg bg-slate-800 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 ring-1 ring-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">
                Пароль <span className="text-slate-500 font-normal">(мин. 12 символов)</span>
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type={showPwd ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-lg bg-slate-800 py-2.5 pl-10 pr-10 text-sm text-white placeholder-slate-500 ring-1 ring-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Подтверждение пароля</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-lg bg-slate-800 py-2.5 pl-10 pr-10 text-sm text-white placeholder-slate-500 ring-1 ring-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Name */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">
                {role === "tenant_owner" ? "Название салона" : "Ваше имя"}
              </label>
              <div className="relative">
                {role === "tenant_owner" ? (
                  <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                ) : (
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                )}
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={role === "tenant_owner" ? "Beauty Studio" : "Анна Иванова"}
                  className="w-full rounded-lg bg-slate-800 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 ring-1 ring-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>

            {/* Role */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Роль</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRole("tenant_owner")}
                  className={`rounded-lg py-2.5 text-sm font-medium transition ring-1 ${
                    role === "tenant_owner"
                      ? "bg-brand-500/20 text-brand-400 ring-brand-500/40"
                      : "bg-slate-800 text-slate-400 ring-slate-700 hover:bg-slate-700"
                  }`}
                >
                  Владелец салона
                </button>
                <button
                  type="button"
                  onClick={() => setRole("master")}
                  className={`rounded-lg py-2.5 text-sm font-medium transition ring-1 ${
                    role === "master"
                      ? "bg-brand-500/20 text-brand-400 ring-brand-500/40"
                      : "bg-slate-800 text-slate-400 ring-slate-700 hover:bg-slate-700"
                  }`}
                >
                  Мастер
                </button>
              </div>
            </div>

            {/* Referral Source */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Где узнали о нас?</label>
              <select
                value={referralSource}
                onChange={(e) => setReferralSource(e.target.value)}
                className="w-full rounded-lg bg-slate-800 py-2.5 px-3 text-sm text-white ring-1 ring-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500 appearance-none"
              >
                <option value="">Выберите...</option>
                <option value="google">Google</option>
                <option value="instagram">Instagram</option>
                <option value="telegram">Telegram</option>
                <option value="friends">Друзья / знакомые</option>
                <option value="other">Другое</option>
              </select>
            </div>

            {/* Error */}
            {error && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400 ring-1 ring-red-500/20">
                {error}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
            >
              {isPending ? "Регистрация..." : "Зарегистрироваться"}
            </button>
          </form>

          {/* Google */}
          {hasGoogle && (
            <>
              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-700" />
                <span className="text-xs text-slate-500">или</span>
                <div className="h-px flex-1 bg-slate-700" />
              </div>

              <button
                type="button"
                disabled={googleLoading}
                onClick={handleGoogleSignIn}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 py-2.5 text-sm font-medium text-white ring-1 ring-slate-700 transition hover:bg-slate-700 disabled:opacity-50"
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

          <p className="mt-4 text-center text-xs text-slate-500">
            Уже есть аккаунт?{" "}
            <a href="/login" className="text-brand-400 hover:underline">
              Войти
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
