import { LogIn } from "lucide-react";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { SearchAutocomplete } from "./SearchAutocomplete";
import { useLanguage } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import brandMark from "@/assets/manicbot-emoji-mark-ui.png";

export function Header() {
  const { t, locale } = useLanguage();
  const { theme } = useTheme();

  const loginHref = `/login?theme=${theme}&lang=${locale}`;

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-slate-200/80 bg-white/75 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[rgba(5,8,18,0.82)]">
      <div className="mx-auto grid h-14 max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-3 px-4 sm:h-16 sm:gap-5 sm:px-6">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2">
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

        {/* Search — centered, fills middle column */}
        <div className="flex items-center justify-center">
          <SearchAutocomplete compact className="w-full max-w-md" />
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <LanguageSwitcher className="hidden sm:flex" />
          <ThemeToggle />
          <a
            href={loginHref}
            className="flex items-center gap-1 rounded-xl border border-violet-300/50 bg-[linear-gradient(135deg,rgba(124,58,237,0.06),rgba(6,182,212,0.06))] px-2.5 py-1.5 text-xs font-semibold text-violet-700 transition-all duration-300 hover:scale-[1.04] hover:border-violet-400 hover:shadow-[0_4px_20px_-6px_rgba(124,58,237,0.3)] sm:gap-1.5 sm:px-3.5 dark:border-violet-400/20 dark:bg-[linear-gradient(135deg,rgba(124,58,237,0.12),rgba(6,182,212,0.1))] dark:text-violet-200 dark:hover:border-violet-400/40 dark:hover:shadow-[0_4px_20px_-6px_rgba(124,58,237,0.35)]"
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
