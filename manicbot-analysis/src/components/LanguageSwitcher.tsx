import { useLanguage, localeOrder, locales } from "@/i18n";

export function LanguageSwitcher() {
  const { locale, setLocale } = useLanguage();

  return (
    <div
      role="group"
      aria-label="Язык / Language"
      className="
        inline-flex max-w-[100vw] items-center gap-0.5 overflow-x-auto scrollbar-none
        rounded-full border border-slate-200/90 bg-white/95 p-1
        shadow-[0_2px_20px_-6px_rgba(124,58,237,0.18),0_0_0_1px_rgba(255,255,255,0.8)_inset]
        backdrop-blur-md
        dark:border-white/10 dark:bg-white/[0.06]
        dark:shadow-[0_2px_24px_-8px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.04)]
      "
    >
      {localeOrder.map((l) => {
        const tr = locales[l];
        const on = l === locale;
        return (
          <button
            key={l}
            type="button"
            onClick={() => setLocale(l)}
            title={tr.fullName}
            className={[
              "relative flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-2 text-xs font-semibold transition-all duration-300 sm:px-3.5",
              on
                ? "scale-[1.02] text-white shadow-[0_4px_16px_-4px_rgba(109,40,217,0.55)]"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-white/90",
            ].join(" ")}
          >
            {on && (
              <span
                className="absolute inset-0 -z-0 rounded-full"
                style={{
                  background: "linear-gradient(135deg, #6d28d9 0%, #0e7490 55%, #0891b2 100%)",
                }}
              />
            )}
            <span className="relative z-10 text-[15px] leading-none sm:text-base" aria-hidden>
              {tr.flag}
            </span>
            <span className="relative z-10 hidden min-w-[1.5rem] tracking-wide sm:inline">
              {tr.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
