"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun, LogIn, ArrowLeft } from "lucide-react";
import { usePublicTheme } from "./ThemeProvider";
import { useLang } from "~/components/LangContext";
import { LangDropdown } from "./LangDropdown";

export function PublicHeader() {
  const { theme, toggleTheme } = usePublicTheme();
  const isDark = theme === "dark";
  const { lang, setLang } = useLang();
  const pathname = usePathname();

  const backHref = pathname.startsWith("/salon/") ? "/search" : "/";

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-slate-200/80 bg-white/75 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[rgba(5,8,18,0.82)]">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6">
        {/* Back button + Brand */}
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <Link
            href={backHref}
            aria-label="Назад"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200/90 bg-white/95 shadow-[0_2px_12px_-4px_rgba(124,58,237,0.15)] backdrop-blur-md outline-none transition-transform hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-violet-500/50 dark:border-white/10 dark:bg-white/[0.06] dark:shadow-[0_2px_16px_-6px_rgba(0,0,0,0.4)]"
          >
            <ArrowLeft className="h-4 w-4 text-slate-600 dark:text-slate-300" strokeWidth={2} />
          </Link>
          <Link href="/" className="flex min-w-0 items-center gap-2.5 pr-1">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm shadow-violet-500/20 dark:shadow-violet-900/30"
              style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
            >
              M
            </span>
            <span className="block truncate text-sm font-bold tracking-tight text-slate-900 dark:text-white sm:text-base">
              ManicBot
              <span className="bg-gradient-to-r from-violet-600 to-cyan-500 bg-clip-text font-bold text-transparent dark:from-violet-400 dark:to-cyan-400">
                .com
              </span>
            </span>
          </Link>
        </div>

        {/* Right controls */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <LangDropdown lang={lang} setLang={setLang} />
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200/90 bg-white/95 shadow-[0_2px_12px_-4px_rgba(124,58,237,0.15)] backdrop-blur-md outline-none transition-transform hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-violet-500/50 dark:border-white/10 dark:bg-white/[0.06] dark:shadow-[0_2px_16px_-6px_rgba(0,0,0,0.4)]"
          >
            {isDark ? (
              <Sun className="h-4 w-4 text-amber-400" strokeWidth={2} />
            ) : (
              <Moon className="h-4 w-4 text-slate-600" strokeWidth={2} />
            )}
          </button>
          <Link
            href="/login"
            className="flex items-center gap-1.5 rounded-xl border border-violet-300/50 bg-[linear-gradient(135deg,rgba(124,58,237,0.06),rgba(6,182,212,0.06))] px-2.5 py-2 text-xs font-semibold text-violet-700 shadow-[0_0_0_0_rgba(124,58,237,0)] transition-all duration-300 hover:scale-[1.04] hover:border-violet-400 hover:shadow-[0_4px_20px_-6px_rgba(124,58,237,0.3)] sm:px-3.5 dark:border-violet-400/20 dark:bg-[linear-gradient(135deg,rgba(124,58,237,0.12),rgba(6,182,212,0.1))] dark:text-violet-200 dark:hover:border-violet-400/40 dark:hover:shadow-[0_4px_20px_-6px_rgba(124,58,237,0.35)]"
            aria-label="Войти"
          >
            <LogIn className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Войти</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
