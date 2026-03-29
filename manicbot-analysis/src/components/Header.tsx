import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { useLanguage } from "@/i18n";
import brandMark from "@/assets/manicbot-emoji-mark-ui.png";

export function Header() {
  const { t } = useLanguage();

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-slate-200/80 bg-white/75 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[rgba(5,8,18,0.82)]">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6">
        <div className="flex min-w-0 shrink-0 items-center gap-2.5 pr-1">
          <span
            className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full shadow-sm shadow-violet-500/20 dark:shadow-violet-900/30"
            aria-hidden
          >
            <img
              src={brandMark}
              alt=""
              width={40}
              height={40}
              className="h-full w-full object-cover"
              decoding="async"
            />
          </span>
          <span className="block truncate text-sm font-bold tracking-tight text-slate-900 dark:text-white sm:text-base">
            ManicBot
            <span
              className="bg-gradient-to-r from-violet-600 to-cyan-500 bg-clip-text font-bold text-transparent dark:from-violet-400 dark:to-cyan-400"
            >
              .com
            </span>
          </span>
        </div>

        <nav className="hidden items-center gap-6 md:flex">
          {[
            { label: t.nav.features, id: "features" },
            { label: t.nav.howItWorks, id: "how" },
            { label: t.nav.pricing, id: "pricing" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => scrollTo(item.id)}
              className="text-sm text-slate-600 transition-colors duration-150 hover:text-violet-700 dark:text-white/50 dark:hover:text-white"
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ThemeToggle />
          <LanguageSwitcher />
          <a
            href="https://dashboard.manicbot.com"
            className="hidden items-center rounded-xl border border-slate-200/80 px-3.5 py-2 text-xs font-medium text-slate-600 transition-all duration-200 hover:border-slate-300 hover:text-slate-900 sm:flex dark:border-white/10 dark:text-white/50 dark:hover:border-white/20 dark:hover:text-white/80"
          >
            {t.nav.login}
          </a>
          <button
            type="button"
            onClick={() => scrollTo("pricing")}
            className="hidden items-center rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-md shadow-violet-500/30 transition-all duration-200 hover:scale-[1.02] hover:opacity-95 sm:flex"
            style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
          >
            {t.nav.cta}
          </button>
        </div>
      </div>
    </header>
  );
}
