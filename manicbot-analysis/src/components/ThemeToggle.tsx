import { ChevronDown, Moon, Sun, type LucideIcon } from "lucide-react";
import { useLanguage } from "@/i18n";
import { useTheme, type Theme } from "@/theme/ThemeProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const triggerClass =
  "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-slate-200/90 bg-white/95 px-2.5 pr-2 text-sm font-semibold shadow-[0_2px_20px_-6px_rgba(124,58,237,0.18)] backdrop-blur-md outline-none transition-transform hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-violet-500/50 dark:border-white/10 dark:bg-white/[0.06] dark:shadow-[0_2px_24px_-8px_rgba(0,0,0,0.45)]";

const contentClass =
  "z-[100] min-w-[10.5rem] rounded-2xl border border-slate-200/90 bg-white/95 p-1.5 shadow-[0_16px_48px_-12px_rgba(15,23,42,0.2)] backdrop-blur-xl dark:border-white/10 dark:bg-[rgba(15,23,42,0.96)] dark:shadow-[0_20px_50px_-12px_rgba(0,0,0,0.55)]";

const itemClass =
  "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm outline-none transition-colors focus:bg-slate-100 data-[highlighted]:bg-slate-100 dark:focus:bg-white/10 dark:data-[highlighted]:bg-white/10";

const options: { id: Theme; Icon: LucideIcon }[] = [
  { id: "dark", Icon: Moon },
  { id: "light", Icon: Sun },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useLanguage();
  const ActiveIcon = theme === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={triggerClass} aria-label={t.theme.toggleGroup}>
          <ActiveIcon className="h-4 w-4 shrink-0 text-slate-700 dark:text-white/85" strokeWidth={2} />
          <span className="hidden max-w-[4.5rem] truncate text-xs tracking-wide text-slate-700 dark:text-white/80 sm:inline">
            {theme === "dark" ? t.theme.dark : t.theme.light}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 opacity-70 dark:text-white/50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className={contentClass} align="end" sideOffset={8}>
        {options.map(({ id, Icon }) => {
          const on = theme === id;
          const label = id === "dark" ? t.theme.dark : t.theme.light;
          return (
            <DropdownMenuItem
              key={id}
              className={cn(itemClass, on && "bg-violet-500/[0.12] dark:bg-violet-500/20")}
              onSelect={() => setTheme(id)}
            >
              <Icon className="h-4 w-4 text-slate-600 dark:text-white/70" strokeWidth={2} />
              <span className="flex-1 font-medium text-slate-800 dark:text-white/90">{label}</span>
              {on && (
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full text-white"
                  style={{ background: "linear-gradient(135deg,#5b21b6,#0891b2)" }}
                  aria-hidden
                >
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
