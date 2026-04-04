import { useLanguage, localeOrder, locales } from "@/i18n";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useLanguage();

  return (
    <div
      className={`flex items-center rounded-full border border-slate-200/90 bg-white/90 p-1 dark:border-white/10 dark:bg-white/[0.06] ${className}`}
    >
      {localeOrder.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-label={locales[l].fullName}
          className={`rounded-full px-2 py-1 text-[10px] font-semibold transition sm:px-2.5 sm:text-xs ${
            l === locale
              ? "bg-[linear-gradient(135deg,#7c3aed,#06b6d4)] text-white"
              : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          }`}
        >
          {locales[l].name}
        </button>
      ))}
    </div>
  );
}
