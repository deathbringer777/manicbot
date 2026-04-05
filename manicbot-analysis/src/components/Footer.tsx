import { useLanguage } from "@/i18n";

export function Footer() {
  const { t } = useLanguage();

  return (
    <footer className="border-t border-slate-200/90 bg-white/60 py-8 backdrop-blur-sm dark:border-white/[0.06] dark:bg-[rgba(5,8,18,0.65)]">
      {/* Same horizontal grid as Header: max-w-6xl + px-4 sm:px-6 — avoids “narrower” centered block */}
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 text-center sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:text-left">
        <nav
          className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 sm:justify-start"
          aria-label="Footer"
        >
          {t.footer.links.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm text-slate-500 transition-colors duration-150 hover:text-violet-700 dark:text-white/35 dark:hover:text-violet-300"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <p className="shrink-0 text-xs text-slate-400 dark:text-white/25 sm:text-right">{t.footer.copy}</p>
      </div>
    </footer>
  );
}
