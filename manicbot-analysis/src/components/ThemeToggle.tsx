import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/theme/ThemeProvider";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200/90 bg-white/95 shadow-[0_2px_12px_-4px_rgba(124,58,237,0.15)] backdrop-blur-md outline-none transition-transform hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-violet-500/50 dark:border-white/10 dark:bg-white/[0.06] dark:shadow-[0_2px_16px_-6px_rgba(0,0,0,0.4)]"
    >
      {isDark ? (
        <Sun className="h-4 w-4 text-amber-400" strokeWidth={2} />
      ) : (
        <Moon className="h-4 w-4 text-slate-600" strokeWidth={2} />
      )}
    </button>
  );
}
