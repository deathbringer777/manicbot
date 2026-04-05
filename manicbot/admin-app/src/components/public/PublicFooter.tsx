"use client";

import Link from "next/link";
import { useLang } from "~/components/LangContext";
import { PUBLIC_FOOTER_BY_LANG } from "~/lib/publicFooterCopy";

export function PublicFooter() {
  const { lang } = useLang();
  const { links, copy } = PUBLIC_FOOTER_BY_LANG[lang] ?? PUBLIC_FOOTER_BY_LANG.en;

  return (
    <footer className="border-t border-slate-200/90 bg-white/60 py-8 backdrop-blur-sm dark:border-white/[0.06] dark:bg-[rgba(5,8,18,0.65)]">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left sm:px-6">
        <nav
          className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 sm:justify-start"
          aria-label="Footer"
        >
          {links.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-slate-500 transition-colors duration-150 hover:text-violet-700 dark:text-white/35 dark:hover:text-violet-300"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <p className="shrink-0 text-xs text-slate-400 dark:text-white/25 sm:text-right">{copy}</p>
      </div>
    </footer>
  );
}
