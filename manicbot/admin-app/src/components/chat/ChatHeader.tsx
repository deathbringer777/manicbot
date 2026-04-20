"use client";

import type { ChatSalon } from "./chatTypes";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

export function ChatHeader({ salon }: { salon: ChatSalon }) {
  const palette = salon.brandPalette?.primary ?? "#EC4899";
  const { lang } = useLang();
  const onlineLabel = t("chat.online", lang);

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
    </header>
  );
}
