"use client";

/**
 * ClientRow — one line in the Clients tab list.
 *
 * Compact, scannable. Avatar initial, name, channel icons (phone / email /
 * @tg / @ig), tag chips, visit counter, "blocked" badge. Whole row is
 * clickable; opens `ClientDetailModal`. Edit / delete / block actions live
 * inside the detail modal — no inline dropdowns to keep the row clean.
 */
import { Phone, Mail, Send, Instagram, Ban, Star } from "lucide-react";

export interface ClientRowData {
  chatId: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  tgUsername: string | null;
  igUsername: string | null;
  tags: string | null;
  lifetimeVisits: number;
  lastVisitAt: number | null;
  isBlockedGlobal: number;
}

interface Props {
  c: ClientRowData;
  onClick: () => void;
}

function formatLastVisit(unix: number | null, lang: string): string {
  if (!unix) return "—";
  const d = new Date(unix * 1000);
  const localeMap: Record<string, string> = {
    ru: "ru-RU", ua: "uk-UA", en: "en-GB", pl: "pl-PL",
  };
  return new Intl.DateTimeFormat(localeMap[lang] ?? "en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  }).format(d);
}

export function ClientRow({ c, onClick }: Props) {
  const initial = (c.name ?? "?").charAt(0).toUpperCase();
  const channelIcons = [
    c.phone && <Phone key="ph" className="h-3 w-3 text-slate-400" aria-label="phone" />,
    c.email && <Mail key="em" className="h-3 w-3 text-slate-400" aria-label="email" />,
    c.tgUsername && <Send key="tg" className="h-3 w-3 text-sky-500" aria-label="telegram" />,
    c.igUsername && <Instagram key="ig" className="h-3 w-3 text-pink-500" aria-label="instagram" />,
  ].filter(Boolean);

  const tags = c.tags
    ? c.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`client-row-${c.chatId}`}
      className="glass-card group flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:border-brand-500/40 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-500/40"
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          c.isBlockedGlobal
            ? "bg-rose-500/15 text-rose-400"
            : "bg-gradient-to-br from-brand-500/20 to-violet-500/20 text-brand-400"
        }`}
      >
        {initial}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
            {c.name ?? `#${c.chatId}`}
          </p>
          {c.lifetimeVisits >= 5 && (
            <Star
              className="h-3.5 w-3.5 text-amber-400 fill-amber-400 shrink-0"
              aria-label="loyal-client"
            />
          )}
          {c.isBlockedGlobal === 1 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-400">
              <Ban className="h-3 w-3" /> blocked
            </span>
          )}
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
          {c.phone && <span>{c.phone}</span>}
          {c.email && (
            <span className="hidden sm:inline truncate max-w-[160px]">{c.email}</span>
          )}
          {c.tgUsername && <span className="text-sky-500">@{c.tgUsername}</span>}
          {c.igUsername && <span className="text-pink-500">@{c.igUsername}</span>}
          {channelIcons.length > 0 && (
            <span className="inline-flex items-center gap-0.5 sm:hidden">
              {channelIcons}
            </span>
          )}
        </div>

        {tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-white/[0.06] dark:text-slate-300"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 text-right text-[11px] text-slate-500">
        <div className="font-semibold text-slate-700 dark:text-slate-200">
          {c.lifetimeVisits}
        </div>
        <div>{formatLastVisit(c.lastVisitAt, "ru")}</div>
      </div>
    </button>
  );
}
