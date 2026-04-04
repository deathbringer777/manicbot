import { useState } from "react";
import { LogIn, Search } from "lucide-react";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { useLanguage } from "@/i18n";
import brandMark from "@/assets/manicbot-emoji-mark-ui.png";

export function Header() {
  const { t } = useLanguage();
  const [q, setQ] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    if (query) {
      window.location.href = `/search?q=${encodeURIComponent(query)}`;
    } else {
      window.location.href = "/search";
    }
  };

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-slate-200/80 bg-white/75 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[rgba(5,8,18,0.82)]">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-3 sm:px-6">
        {/* Logo */}
        <a href="/" className="flex min-w-0 shrink-0 items-center gap-2.5">
          <span
            className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full shadow-sm shadow-violet-500/20 dark:shadow-violet-900/30"
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

        {/* Search — center, hidden on mobile */}
        <form
          onSubmit={handleSearch}
          className="hidden flex-1 items-center justify-center sm:flex"
        >
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-white/30" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t.hero.searchPlaceholder}
              className="h-9 w-full rounded-full border border-slate-200/80 bg-slate-50/80 pl-9 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400/60 focus:bg-white focus:ring-2 focus:ring-violet-400/15 dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:placeholder:text-white/30 dark:focus:border-violet-500/40 dark:focus:bg-white/[0.08]"
            />
          </div>
        </form>

        {/* Right controls */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ThemeToggle />
          <LanguageSwitcher />
          <a
            href="/login"
            className="flex items-center gap-1.5 rounded-xl border border-violet-300/50 bg-[linear-gradient(135deg,rgba(124,58,237,0.06),rgba(6,182,212,0.06))] px-2.5 py-2 text-xs font-semibold text-violet-700 shadow-[0_0_0_0_rgba(124,58,237,0)] transition-all duration-300 hover:scale-[1.04] hover:border-violet-400 hover:shadow-[0_4px_20px_-6px_rgba(124,58,237,0.3)] sm:px-3.5 dark:border-violet-400/20 dark:bg-[linear-gradient(135deg,rgba(124,58,237,0.12),rgba(6,182,212,0.1))] dark:text-violet-200 dark:hover:border-violet-400/40 dark:hover:shadow-[0_4px_20px_-6px_rgba(124,58,237,0.35)]"
            aria-label={t.nav.login}
          >
            <LogIn className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">{t.nav.login}</span>
          </a>
        </div>
      </div>
    </header>
  );
}
