import { useLanguage } from "@/i18n";
import { useTheme, type Theme } from "@/theme/ThemeProvider";

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
      />
    </svg>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path
        strokeLinecap="round"
        d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
      />
    </svg>
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useLanguage();

  const select = (next: Theme) => setTheme(next);

  return (
    <div
      role="group"
      aria-label={t.theme.toggleGroup}
      className="inline-flex items-center gap-0.5 rounded-full border border-slate-200/90 bg-white/95 p-1 shadow-[0_2px_20px_-6px_rgba(124,58,237,0.18)] backdrop-blur-md dark:border-white/10 dark:bg-white/[0.06] dark:shadow-[0_2px_24px_-8px_rgba(0,0,0,0.5)]"
    >
      {(
        [
          { id: "dark" as const, label: t.theme.dark, Icon: MoonIcon },
          { id: "light" as const, label: t.theme.light, Icon: SunIcon },
        ] as const
      ).map(({ id, label, Icon }) => {
        const on = theme === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => select(id)}
            title={label}
            aria-pressed={on}
            className={[
              "relative flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition-all duration-300",
              on
                ? "scale-[1.02] text-white shadow-[0_4px_14px_-4px_rgba(109,40,217,0.5)] dark:shadow-[0_4px_20px_-4px_rgba(124,58,237,0.45)]"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-white/90",
            ].join(" ")}
          >
            {on && (
              <span
                className="absolute inset-0 rounded-full"
                style={{
                  background: "linear-gradient(135deg, #5b21b6 0%, #0e7490 55%, #0891b2 100%)",
                }}
              />
            )}
            <Icon className="relative z-10 h-4 w-4" />
            <span className="relative z-10 hidden tracking-wide sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
