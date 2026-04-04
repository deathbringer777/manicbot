import { useLanguage, localeOrder, locales } from "@/i18n";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useLanguage();

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as typeof locale)}
      aria-label="Language"
      className={`h-8 cursor-pointer appearance-none rounded-full border border-slate-200/90 bg-white/90 px-3 text-xs font-semibold text-slate-700 outline-none transition hover:border-slate-300 focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/15 dark:border-white/10 dark:bg-white/[0.06] dark:text-white/80 dark:hover:border-white/20 dark:focus:border-violet-500/40 sm:h-9 ${className}`}
    >
      {localeOrder.map((l) => (
        <option key={l} value={l}>
          {locales[l].name}
        </option>
      ))}
    </select>
  );
}
