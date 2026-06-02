/**
 * Semantic classification of the Telegram-style inline keyboards the web chat
 * receives from the Worker bot, so the widget can render rich web UI (a date
 * strip, a photo carousel) instead of a raw column of buttons.
 *
 * Callback-data prefixes MUST mirror the Worker's `CB` map in
 * `manicbot/src/config.js` (source of truth). They are duplicated here because
 * the admin-app and the Worker are separate build units.
 */
import type { ChatButton } from "./chatTypes";

export const CHAT_CB = {
  /** CB.DATE — a day pick: `dt:YYYY-MM-DD` */
  DATE: "dt:",
  /** CB.CAL_MONTH — month nav: `cm:0` | `cm:1` | `cm:2` */
  MONTH: "cm:",
  /** CB.NOOP — non-interactive filler (headers, spacers, counters) */
  NOOP: "_",
  /** CB.CAT_PHOTO — catalog photo nav: `cc:svcId:idx` */
  CAT_PHOTO: "cc:",
} as const;

export function flattenButtons(rows: ChatButton[][] | null | undefined): ChatButton[] {
  if (!rows) return [];
  return rows.flat();
}

/**
 * A date-selection keyboard is unambiguously identified by the presence of any
 * `dt:` (day) or `cm:` (month-nav) callback — no other keyboard uses them.
 */
export function isDateKeyboard(rows: ChatButton[][] | null | undefined): boolean {
  return flattenButtons(rows).some(
    (b) =>
      b.callback_data?.startsWith(CHAT_CB.DATE) ||
      b.callback_data?.startsWith(CHAT_CB.MONTH),
  );
}

export interface ParsedDay {
  /** ISO `YYYY-MM-DD` */
  iso: string;
  /** Day-of-month 1..31 (parsed from the ISO date, not the button text). */
  day: number;
  /** The `dt:YYYY-MM-DD` callback to send when this day is tapped. */
  callbackData: string;
  /** The bot wraps the current day as `[12]` — surfaced for a "today" accent. */
  isToday: boolean;
}

export interface ParsedDateKeyboard {
  days: ParsedDay[];
  /** Month-nav buttons (text ◀️ / ▶️) when available, else null. */
  prevMonth: ChatButton | null;
  nextMonth: ChatButton | null;
  /** The trailing interactive button (calKb's "other service" → CB.BOOK). */
  footer: ChatButton | null;
}

/**
 * Turn a calKb-shaped keyboard into structured data. Spacer/header NOOP cells
 * are dropped; arrows are split into prev/next by their glyph.
 */
export function parseDateKeyboard(rows: ChatButton[][]): ParsedDateKeyboard {
  const flat = flattenButtons(rows);
  const days: ParsedDay[] = [];
  let prevMonth: ChatButton | null = null;
  let nextMonth: ChatButton | null = null;
  let footer: ChatButton | null = null;

  for (const b of flat) {
    const cd = b.callback_data ?? "";
    if (cd.startsWith(CHAT_CB.DATE)) {
      const iso = cd.slice(CHAT_CB.DATE.length);
      const day = Number(iso.slice(8, 10));
      days.push({
        iso,
        day: Number.isFinite(day) ? day : 0,
        callbackData: cd,
        isToday: /^\[.*\]$/.test((b.text ?? "").trim()),
      });
    } else if (cd.startsWith(CHAT_CB.MONTH)) {
      const txt = b.text ?? "";
      if (txt.includes("◀")) prevMonth = b;
      else if (txt.includes("▶")) nextMonth = b;
    } else if (cd && cd !== CHAT_CB.NOOP) {
      // Any other interactive button (calKb only emits the "other service"
      // link here) becomes the footer affordance.
      footer = b;
    }
  }

  return { days, prevMonth, nextMonth, footer };
}

/**
 * When the web widget renders its own photo carousel, the bot's `cc:` photo-nav
 * arrows + the `N / M` NOOP counter are redundant — strip them, keeping the
 * "book"/"back" actions. Empty rows are dropped.
 */
export function stripPhotoNavButtons(
  rows: ChatButton[][] | null | undefined,
): ChatButton[][] {
  if (!rows) return [];
  return rows
    .map((row) =>
      row.filter(
        (b) => !b.callback_data?.startsWith(CHAT_CB.CAT_PHOTO) && b.callback_data !== CHAT_CB.NOOP,
      ),
    )
    .filter((row) => row.length > 0);
}
