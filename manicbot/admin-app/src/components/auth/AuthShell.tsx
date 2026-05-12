"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, MessageCircleMore, Moon, Sun, Users2 } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { PublicThemeProvider, usePublicTheme } from "~/components/public/ThemeProvider";
import { LangDropdown } from "~/components/public/LangDropdown";
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
  const { theme, toggleTheme } = usePublicTheme();
  const isDark = theme === "dark";
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

  const landingHref = `/?theme=${theme}&lang=${lang}`;

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    window.location.href = `https://manicbot.com${landingHref}`;
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50 text-slate-900 transition-all duration-500 ease-out dark:bg-[#050816] dark:text-white animate-[fadeIn_0.4s_ease-out]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(232,121,160,0.15),transparent_26%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.18),transparent_28%),radial-gradient(circle_at_50%_120%,rgba(124,58,237,0.16),transparent_38%),linear-gradient(180deg,#f8fbff_0%,#eef2ff_48%,#f8fbff_100%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(232,121,160,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_24%),radial-gradient(circle_at_50%_120%,rgba(124,58,237,0.22),transparent_38%),linear-gradient(180deg,#080b1a_0%,#050816_52%,#090f1f_100%)]" />
        <div className="absolute -left-10 top-16 h-40 w-40 rounded-full bg-fuchsia-400/20 blur-3xl dark:bg-fuchsia-500/20 sm:h-72 sm:w-72" />
        <div className="absolute right-[-2rem] top-[-1rem] h-52 w-52 rounded-full bg-cyan-300/20 blur-3xl dark:bg-cyan-400/15 sm:h-80 sm:w-80" />
        <div className="absolute bottom-[-4rem] left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-violet-400/20 blur-3xl dark:bg-brand-500/15 sm:h-96 sm:w-96" />
        <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(15,23,42,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.12)_1px,transparent_1px)] [background-size:72px_72px] dark:[background-image:linear-gradient(rgba(255,255,255,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.14)_1px,transparent_1px)]" />
      </div>

      {/* Fixed top header — matches landing page design */}
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-slate-200/80 bg-white/75 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[rgba(5,8,18,0.82)]">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-3 sm:gap-3 sm:px-6">
          {/* Back button */}
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 dark:text-white/60 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">{copy.shared.back}</span>
          </button>

          {/* Divider */}
          <div className="h-5 w-px shrink-0 bg-slate-200 dark:bg-white/10" />

          {/* Logo */}
          <a href={landingHref} className="flex items-center gap-2.5">
            <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full shadow-sm shadow-violet-500/20 dark:shadow-violet-900/30">
              <Image
                src="/manicbot-mark-ui.png"
                alt="ManicBot"
                fill
                sizes="36px"
                className="object-cover"
                priority
              />
            </div>
            <span className="hidden text-sm font-bold tracking-tight text-slate-900 dark:text-white sm:block">
              {copy.shared.brandTitle}
              <span className="bg-gradient-to-r from-violet-600 to-cyan-500 bg-clip-text text-transparent dark:from-violet-400 dark:to-cyan-400">
                .com
              </span>
            </span>
          </a>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right controls */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Language dropdown */}
            <LangDropdown lang={lang} setLang={setLang} />

            {/* Theme toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200/90 bg-white/95 shadow-[0_2px_12px_-4px_rgba(124,58,237,0.15)] outline-none transition-transform hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-violet-500/50 dark:border-white/10 dark:bg-white/[0.06] dark:shadow-[0_2px_16px_-6px_rgba(0,0,0,0.4)]"
            >
              {isDark ? (
                <Sun className="h-4 w-4 text-amber-400" strokeWidth={2} />
              ) : (
                <Moon className="h-4 w-4 text-slate-600" strokeWidth={2} />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Page content — offset for fixed header */}
      <div className="relative px-4 pb-8 pt-20 sm:px-6 sm:pb-10 sm:pt-24 lg:px-8">
        <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-7xl flex-col">
          <div className="animate-slide-up grid flex-1 items-center gap-10 pt-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(380px,470px)] lg:gap-14 lg:pt-8">
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
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full shadow-[0_18px_40px_-22px_rgba(124,58,237,0.7)]">
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
