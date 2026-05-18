"use client";

import { Moon, Sun } from "lucide-react";
import type { ChatSalon } from "./chatTypes";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { usePublicTheme } from "~/components/public/ThemeProvider";
import { LangDropdown } from "~/components/public/LangDropdown";

export function ChatHeader({ salon }: { salon: ChatSalon }) {
  const palette = salon.brandPalette?.primary ?? "#EC4899";
  const { lang, setLang } = useLang();
  const { theme, toggleTheme } = usePublicTheme();
  const onlineLabel = t("chat.online", lang);
  const isDark = theme === "dark";

  return (
    <header
      className="relative flex items-center gap-3 px-4 py-3 md:py-4 border-b border-slate-200/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md"
      style={{
        background: `linear-gradient(135deg, ${palette}12 0%, transparent 100%)`,
      }}
    >
      <div className="relative">
        {salon.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={salon.logo}
            alt={salon.name}
            className="h-10 w-10 rounded-full object-cover border border-slate-200/60 dark:border-white/10"
          />
        ) : (
          <div
            className="h-10 w-10 rounded-full flex items-center justify-center text-white font-bold"
            style={{ background: palette }}
            aria-hidden
          >
            {salon.name.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 border-2 border-white dark:border-slate-900" />
      </div>
      <div className="flex-1 min-w-0">
        <h1 className="text-sm md:text-base font-semibold text-slate-900 dark:text-white truncate">
          {salon.name}
        </h1>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 truncate">
          <span className="truncate">
            {salon.city ? `${onlineLabel} · ${salon.city}` : onlineLabel}
          </span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <LangDropdown lang={lang} setLang={setLang} />
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200/90 bg-white/95 outline-none transition-transform hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-violet-500/50 dark:border-white/10 dark:bg-white/[0.06]"
        >
          {isDark ? (
            <Sun className="h-4 w-4 text-amber-400" strokeWidth={2} />
          ) : (
            <Moon className="h-4 w-4 text-slate-600" strokeWidth={2} />
          )}
        </button>
      </div>
    </header>
  );
}
