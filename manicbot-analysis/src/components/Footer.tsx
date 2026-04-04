import { useLanguage } from "@/i18n";

const LINK_HREFS = ["#", "#", "#", "#"];

export function Footer() {
  const { t } = useLanguage();

  return (
    <footer className="border-t border-slate-200/90 bg-white/60 px-4 py-8 backdrop-blur-sm dark:border-white/[0.06] dark:bg-[rgba(5,8,18,0.65)]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="flex flex-wrap items-center justify-center gap-4 sm:justify-start sm:gap-5">
          {t.footer.links.map((link, i) => (
            <a
              key={link}
              href={LINK_HREFS[i] ?? "#"}
              className="text-xs text-slate-500 transition-colors duration-150 hover:text-violet-700 dark:text-white/35 dark:hover:text-violet-300"
            >
              {link}
            </a>
          ))}
        </div>

        <p className="text-xs text-slate-400 dark:text-white/25">{t.footer.copy}</p>
      </div>
    </footer>
  );
}
