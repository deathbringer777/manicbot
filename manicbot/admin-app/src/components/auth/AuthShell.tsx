"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, MessageCircleMore, Moon, Sun, Users2 } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { PublicThemeProvider, usePublicTheme } from "~/components/public/ThemeProvider";
import { LANGS } from "~/lib/i18n";
import { authCopy } from "./copy";

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  panelTitle: string;
  panelDescription: string;
  children: ReactNode;
  footer: ReactNode;
};

type Feature = {
  icon: typeof MessageCircleMore;
  title: string;
  text: string;
};

export const authFieldClassName =
  "w-full rounded-2xl border border-slate-200/90 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.3)] outline-none transition focus:border-cyan-400/60 focus:ring-4 focus:ring-cyan-400/12 dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:placeholder:text-slate-500 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";

export const authFieldWithLeadingIconClassName = `${authFieldClassName} pl-11`;

export const authFieldWithIconsClassName = `${authFieldWithLeadingIconClassName} pr-11`;

export const authPrimaryButtonClassName =
  "w-full rounded-2xl bg-[linear-gradient(135deg,#7c3aed_0%,#06b6d4_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_-18px_rgba(34,211,238,0.45)] transition duration-200 hover:scale-[1.01] hover:shadow-[0_24px_55px_-18px_rgba(124,58,237,0.55)] disabled:cursor-not-allowed disabled:opacity-60";

export const authSecondaryButtonClassName =
  "flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200/90 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:hover:bg-white/[0.08]";

function AuthShellInner({
  eyebrow,
  title,
  description,
  panelTitle,
  panelDescription,
  children,
  footer,
}: AuthShellProps) {
  const router = useRouter();
  const { lang, setLang } = useLang();
  const { theme, setTheme } = usePublicTheme();
  const copy = authCopy[lang];

  const features: Feature[] = [
    {
      icon: MessageCircleMore,
      title: copy.shared.featureOneTitle,
      text: copy.shared.featureOneText,
    },
    {
      icon: CalendarDays,
      title: copy.shared.featureTwoTitle,
      text: copy.shared.featureTwoText,
    },
    {
      icon: Users2,
      title: copy.shared.featureThreeTitle,
      text: copy.shared.featureThreeText,
    },
  ];

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    window.location.href = "https://manicbot.com";
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50 text-slate-900 transition-colors dark:bg-[#050816] dark:text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(232,121,160,0.15),transparent_26%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.18),transparent_28%),radial-gradient(circle_at_50%_120%,rgba(124,58,237,0.16),transparent_38%),linear-gradient(180deg,#f8fbff_0%,#eef2ff_48%,#f8fbff_100%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(232,121,160,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_24%),radial-gradient(circle_at_50%_120%,rgba(124,58,237,0.22),transparent_38%),linear-gradient(180deg,#080b1a_0%,#050816_52%,#090f1f_100%)]" />
        <div className="absolute -left-10 top-16 h-40 w-40 rounded-full bg-fuchsia-400/20 blur-3xl dark:bg-fuchsia-500/20 sm:h-72 sm:w-72" />
        <div className="absolute right-[-2rem] top-[-1rem] h-52 w-52 rounded-full bg-cyan-300/20 blur-3xl dark:bg-cyan-400/15 sm:h-80 sm:w-80" />
        <div className="absolute bottom-[-4rem] left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-violet-400/20 blur-3xl dark:bg-brand-500/15 sm:h-96 sm:w-96" />
        <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(15,23,42,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.12)_1px,transparent_1px)] [background-size:72px_72px] dark:[background-image:linear-gradient(rgba(255,255,255,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.14)_1px,transparent_1px)]" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-4 pb-8 pt-4 sm:px-6 sm:pb-10 sm:pt-6 lg:px-8">
        <header className="rounded-[28px] border border-slate-200/80 bg-white/75 p-3 shadow-[0_30px_80px_-48px_rgba(15,23,42,0.4)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[0_30px_100px_-50px_rgba(2,6,23,0.95)]">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/85 dark:hover:bg-white/[0.08]"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              <span>{copy.shared.back}</span>
            </button>

            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-2xl shadow-[0_18px_45px_-20px_rgba(124,58,237,0.45)]">
                <Image
                  src="/manicbot-mark-ui.png"
                  alt="ManicBot"
                  fill
                  sizes="48px"
                  className="object-cover"
                  priority
                />
              </div>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold tracking-tight text-slate-950 dark:text-white">
                  {copy.shared.brandTitle}
                </p>
                <p className="truncate text-sm text-slate-500 dark:text-slate-300/70">
                  {copy.shared.brandSubtitle}
                </p>
              </div>
            </div>

            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <div className="flex items-center rounded-full border border-slate-200/90 bg-white/90 p-1 dark:border-white/10 dark:bg-white/[0.05]">
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    theme === "light"
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                      : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                  }`}
                >
                  <Sun className="h-3.5 w-3.5" />
                  <span>{copy.shared.themeLight}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    theme === "dark"
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                      : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                  }`}
                >
                  <Moon className="h-3.5 w-3.5" />
                  <span>{copy.shared.themeDark}</span>
                </button>
              </div>

              <div className="flex items-center rounded-full border border-slate-200/90 bg-white/90 p-1 dark:border-white/10 dark:bg-white/[0.05]">
                {LANGS.map(({ code, label }) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setLang(code)}
                    className={`rounded-full px-2.5 py-1.5 text-xs font-semibold transition ${
                      lang === code
                        ? "bg-[linear-gradient(135deg,#7c3aed,#06b6d4)] text-white"
                        : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </header>

        <div className="grid flex-1 items-center gap-10 pt-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(380px,470px)] lg:gap-14 lg:pt-12">
          <div className="max-w-2xl">
            <div className="inline-flex items-center rounded-full border border-slate-200/90 bg-white/70 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-700 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.05] dark:text-cyan-200/85">
              {eyebrow}
            </div>

            <h1 className="mt-5 text-[2.15rem] font-semibold leading-[1.04] tracking-tight text-slate-950 dark:text-white sm:text-5xl lg:text-[3.35rem]">
              {title}
            </h1>

            <p className="mt-4 max-w-xl text-base leading-7 text-slate-600 dark:text-slate-300/78">
              {description}
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {features.map(({ icon: Icon, title: featureTitle, text }) => (
                <div
                  key={featureTitle}
                  className="rounded-[24px] border border-slate-200/80 bg-white/68 p-4 shadow-[0_20px_50px_-34px_rgba(15,23,42,0.35)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.05] dark:shadow-[0_18px_40px_-30px_rgba(2,6,23,0.95)]"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900/5 text-cyan-700 dark:bg-white/10 dark:text-cyan-200">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">{featureTitle}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300/72">{text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-start justify-center lg:justify-end">
            <div className="w-full max-w-lg rounded-[32px] border border-slate-200/80 bg-white/86 p-5 shadow-[0_35px_100px_-42px_rgba(15,23,42,0.45)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/58 dark:shadow-[0_30px_100px_-40px_rgba(8,145,178,0.55)] sm:p-6 lg:p-7">
              <div className="mb-6 flex items-start gap-4">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[20px] shadow-[0_18px_40px_-22px_rgba(124,58,237,0.7)]">
                  <Image
                    src="/manicbot-mark-ui.png"
                    alt="ManicBot"
                    fill
                    sizes="56px"
                    className="object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-700 dark:text-cyan-200/75">
                    {copy.shared.brandTitle}
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-[1.75rem]">
                    {panelTitle}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300/72">
                    {panelDescription}
                  </p>
                </div>
              </div>

              {children}

              <div className="mt-5 border-t border-slate-200/80 pt-4 text-sm text-slate-600 dark:border-white/10 dark:text-slate-300/70">
                {footer}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AuthShell(props: AuthShellProps) {
  return (
    <PublicThemeProvider>
      <AuthShellInner {...props} />
    </PublicThemeProvider>
  );
}
