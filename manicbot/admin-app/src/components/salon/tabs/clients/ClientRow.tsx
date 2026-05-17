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
import { resolveAvatarEmoji } from "~/lib/clientAvatar";

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
  // 0072 avatar fields. Either may be null — UI falls back to the default emoji.
  avatarEmoji?: string | null;
  avatarUrl?: string | null;
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

  // Mobile (<sm): show only the single most-useful contact line truncated +
  // small icon row for additional channels. Tablet+: show all known
  // channels inline.
  const primaryContact =
    c.phone
    ?? c.email
    ?? (c.tgUsername ? `@${c.tgUsername}` : null)
    ?? (c.igUsername ? `@${c.igUsername}` : null);

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`client-row-${c.chatId}`}
      className="glass-card group flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:border-brand-500/40 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-500/40 active:scale-[0.99]"
    >
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full text-xl font-bold sm:h-10 sm:w-10 sm:text-lg ${
          c.isBlockedGlobal
            ? "bg-rose-500/15 text-rose-400"
            : "bg-gradient-to-br from-brand-500/20 to-violet-500/20 text-brand-400"
        }`}
        data-testid={`client-row-avatar-${c.chatId}`}
      >
        {c.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={c.avatarUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <span>{resolveAvatarEmoji(c.avatarEmoji ?? null)}</span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
            {c.name ?? `#${c.chatId}`}
          </p>
          {c.lifetimeVisits >= 5 && (
            <Star
              className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400"
              aria-label="loyal-client"
            />
          )}
          {c.isBlockedGlobal === 1 && (
            <Ban
              className="h-3.5 w-3.5 shrink-0 text-rose-400"
              aria-label="blocked"
            />
          )}
        </div>

        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
          {/* Mobile: single truncated contact line. */}
          <span className="truncate sm:hidden">{primaryContact ?? "—"}</span>
          {/* Tablet+: inline list of every known channel. */}
          <span className="hidden flex-wrap items-center gap-x-2 gap-y-1 sm:flex">
            {c.phone && <span>{c.phone}</span>}
            {c.email && <span className="max-w-[160px] truncate">{c.email}</span>}
            {c.tgUsername && <span className="text-sky-500">@{c.tgUsername}</span>}
            {c.igUsername && <span className="text-pink-500">@{c.igUsername}</span>}
          </span>
          {/* Mobile icon row — only shown when there's more than 1 channel. */}
          {channelIcons.length > 1 && (
            <span className="inline-flex shrink-0 items-center gap-0.5 sm:hidden">
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
        <div className="text-base font-semibold leading-tight text-slate-700 dark:text-slate-200 sm:text-sm">
          {c.lifetimeVisits}
        </div>
        {/* Last-visit date drops off on the narrowest mobile widths to
            keep the row from line-wrapping with long client names. */}
        <div className="hidden sm:block">{formatLastVisit(c.lastVisitAt, "ru")}</div>
      </div>
    </button>
  );
}
