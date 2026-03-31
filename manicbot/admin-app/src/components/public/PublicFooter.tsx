"use client";

import Link from "next/link";

export function PublicFooter() {
  return (
    <footer className="border-t border-slate-200/90 bg-white/60 px-4 py-10 backdrop-blur-sm dark:border-white/[0.06] dark:bg-[rgba(5,8,18,0.65)]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold text-white shadow-sm"
            style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
          >
            M
          </div>
          <span className="text-xs text-slate-500 dark:text-white/40">
            Платформа записи для nail-салонов
          </span>
        </div>

        <div className="flex items-center gap-5">
          <Link
            href="/search"
            className="text-xs text-slate-500 transition-colors duration-150 hover:text-violet-700 dark:text-white/35 dark:hover:text-violet-300"
          >
            Найти салон
          </Link>
          <Link
            href="/login"
            className="text-xs text-slate-500 transition-colors duration-150 hover:text-violet-700 dark:text-white/35 dark:hover:text-violet-300"
          >
            Кабинет
          </Link>
          <a
            href="https://t.me/manic_preview_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-500 transition-colors duration-150 hover:text-violet-700 dark:text-white/35 dark:hover:text-violet-300"
          >
            Telegram
          </a>
        </div>

        <p className="text-xs text-slate-400 dark:text-white/25">
          &copy; {new Date().getFullYear()} ManicBot
        </p>
      </div>
    </footer>
  );
}
