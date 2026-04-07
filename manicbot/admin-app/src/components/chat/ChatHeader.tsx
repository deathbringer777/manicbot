"use client";

import type { ChatSalon } from "./chatTypes";
import { MessageCircle } from "lucide-react";

export function ChatHeader({ salon }: { salon: ChatSalon }) {
  const palette = salon.brandPalette?.primary ?? "#EC4899";

  return (
    <header
      className="relative flex items-center gap-3 px-4 py-3 border-b border-white/10 bg-white/5 backdrop-blur-md"
      style={{
        background: `linear-gradient(135deg, ${palette}20 0%, transparent 100%)`,
      }}
    >
      {salon.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={salon.logo}
          alt={salon.name}
          className="h-10 w-10 rounded-full object-cover border border-white/10"
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
      <div className="flex-1 min-w-0">
        <h1 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
          {salon.name}
        </h1>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 truncate">
          <MessageCircle className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {salon.city ? `онлайн · ${salon.city}` : "онлайн"}
          </span>
        </p>
      </div>
    </header>
  );
}
