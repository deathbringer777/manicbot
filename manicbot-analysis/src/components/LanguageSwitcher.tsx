import { useLanguage, localeOrder, locales } from "@/i18n";

export function LanguageSwitcher() {
  const { locale, setLocale } = useLanguage();

  return (
    <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/8">
      {localeOrder.map((l) => {
        const t = locales[l];
        const isActive = l === locale;
        return (
          <button
            key={l}
            onClick={() => setLocale(l)}
            title={t.fullName}
            className={[
              "relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200",
              isActive
                ? "text-white shadow-sm"
                : "text-white/40 hover:text-white/70 hover:bg-white/5",
            ].join(" ")}
          >
            {isActive && (
              <span
                className="absolute inset-0 rounded-lg"
                style={{
                  background: "linear-gradient(135deg, #7c3aed, #06b6d4)",
                  opacity: 0.9,
                }}
              />
            )}
            <span className="relative z-10 text-sm leading-none">{t.flag}</span>
            <span className="relative z-10 tracking-wide">{t.name}</span>
          </button>
        );
      })}
    </div>
  );
}
