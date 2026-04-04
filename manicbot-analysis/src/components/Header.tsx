import { useState } from "react";
import { LogIn, Search } from "lucide-react";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { useLanguage } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import brandMark from "@/assets/manicbot-emoji-mark-ui.png";

export function Header() {
  const { t, locale } = useLanguage();
  const { theme } = useTheme();
  const [q, setQ] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    window.location.href = query
      ? `/search?q=${encodeURIComponent(query)}`
      : "/search";
  };

  const loginHref = `/login?theme=${theme}&lang=${locale}`;

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-slate-200/80 bg-white/75 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[rgba(5,8,18,0.82)]">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 sm:h-16 sm:gap-3 sm:px-6">
        {/* Logo */}
        <a href="/" className="flex shrink-0 items-center gap-2">
          <span
            className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full shadow-sm shadow-violet-500/20 dark:shadow-violet-900/30 sm:h-9 sm:w-9"
            aria-hidden
          >
            <img
              src={brandMark}
              alt=""
              width={36}
              height={36}
              className="h-full w-full object-cover"
              decoding="async"
            />
          </span>
          <span className="hidden text-sm font-bold tracking-tight text-slate-900 dark:text-white sm:block">
            ManicBot
            <span className="bg-gradient-to-r from-violet-600 to-cyan-500 bg-clip-text font-bold text-transparent dark:from-violet-400 dark:to-cyan-400">
              .com
            </span>
          </span>
        </a>

        {/* Search — always visible, compact on mobile */}
        <form
          onSubmit={handleSearch}
          className="flex min-w-0 flex-1 items-center sm:max-w-xs"
        >
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-white/30 sm:left-3 sm:h-4 sm:w-4" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t.hero.searchPlaceholder}
              className="h-8 w-full rounded-full border border-slate-200/80 bg-slate-50/80 pl-7 pr-3 text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400/60 focus:bg-white focus:ring-2 focus:ring-violet-400/15 dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:placeholder:text-white/30 dark:focus:border-violet-500/40 dark:focus:bg-white/[0.08] sm:h-9 sm:pl-9 sm:text-sm"
            />
          </div>
        </form>

        {/* Right controls */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          <LanguageSwitcher className="hidden sm:flex" />
          <ThemeToggle />
          <a
            href={loginHref}
            className="flex items-center gap-1 rounded-xl border border-violet-300/50 bg-[linear-gradient(135deg,rgba(124,58,237,0.06),rgba(6,182,212,0.06))] px-2 py-1.5 text-xs font-semibold text-violet-700 transition-all duration-300 hover:scale-[1.04] hover:border-violet-400 hover:shadow-[0_4px_20px_-6px_rgba(124,58,237,0.3)] sm:gap-1.5 sm:px-3 dark:border-violet-400/20 dark:bg-[linear-gradient(135deg,rgba(124,58,237,0.12),rgba(6,182,212,0.1))] dark:text-violet-200 dark:hover:border-violet-400/40 dark:hover:shadow-[0_4px_20px_-6px_rgba(124,58,237,0.35)]"
            aria-label={t.nav.login}
          >
            <LogIn className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">{t.nav.login}</span>
          </a>
        </div>
      </div>
    </header>
  );
}
