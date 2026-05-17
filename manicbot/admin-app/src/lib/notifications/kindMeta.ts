/**
 * Per-`kind` UI metadata for the notification feed (bell + /notifications).
 *
 * Single source of truth so the bell dropdown and the full-history page
 * cannot drift. New writers add their domain prefix here; the UI
 * automatically picks up the icon + accent + group bucket.
 *
 * Kind convention: `<domain>.<event>`. Current writers:
 *   - reminder.fired         (reminders plugin cron)
 *   - support.reply          (support replyToTicket)
 *   - support.ticket.new     (support createTicket fan-out)
 *   - support.ticket.reply   (support replyToMyTicket fan-out)
 *   - birthday.client        (birthday cron — tenant_owner)
 *   - appointment.created    (notifyAptStaff — master in-app)
 *   - billing.alert          (future — billing status flip)
 *   - marketing.campaign.sent (future — campaign delivery report)
 */
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Cake,
  Calendar,
  CreditCard,
  LifeBuoy,
  MessageCircle,
  Star,
} from "lucide-react";

export type NotifKind = string;

export interface KindMeta {
  icon: LucideIcon;
  /** Tailwind classes for the small circular icon container. */
  accent: string;
  /** Stable visual category — only used in tests / debug. */
  category:
    | "support"
    | "appointment"
    | "birthday"
    | "billing"
    | "marketing"
    | "messenger"
    | "reminder"
    | "generic";
}

const META_BY_PREFIX: Array<[string, KindMeta]> = [
  ["support.", { icon: LifeBuoy, accent: "text-emerald-500 bg-emerald-500/10", category: "support" }],
  ["appointment.", { icon: Calendar, accent: "text-sky-500 bg-sky-500/10", category: "appointment" }],
  ["birthday.", { icon: Cake, accent: "text-pink-500 bg-pink-500/10", category: "birthday" }],
  ["billing.", { icon: CreditCard, accent: "text-amber-500 bg-amber-500/10", category: "billing" }],
  ["marketing.", { icon: Star, accent: "text-violet-500 bg-violet-500/10", category: "marketing" }],
  ["messenger.", { icon: MessageCircle, accent: "text-indigo-500 bg-indigo-500/10", category: "messenger" }],
  ["thread.", { icon: MessageCircle, accent: "text-indigo-500 bg-indigo-500/10", category: "messenger" }],
  ["reminder.", { icon: Bell, accent: "text-cyan-500 bg-cyan-500/10", category: "reminder" }],
];

const GENERIC: KindMeta = { icon: Bell, accent: "text-slate-500 bg-slate-500/10", category: "generic" };

export function kindMeta(kind: NotifKind): KindMeta {
  for (const [prefix, meta] of META_BY_PREFIX) {
    if (kind.startsWith(prefix)) return meta;
  }
  return GENERIC;
}

/**
 * Render unix-seconds timestamp as a short relative label
 * ("только что", "5 мин", "2 ч", "3 д", "2 нед", "12.01.2026").
 *
 * Pure — accepts an explicit `now` so tests don't depend on the wall
 * clock.
 */
export function formatRelative(unix: number, now: number = Math.floor(Date.now() / 1000)): string {
  const diff = Math.max(0, now - unix);
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days} д`;
  if (days < 30) return `${Math.floor(days / 7)} нед`;
  return new Date(unix * 1000).toLocaleDateString("ru-RU");
}

export type TimeBucket = "today" | "week" | "older";

/** Used by the full-history page for the «Сегодня / На этой неделе / Ранее» splits. */
export function timeBucket(
  unix: number,
  now: number = Math.floor(Date.now() / 1000),
): TimeBucket {
  const diff = now - unix;
  if (diff < 86400) return "today";
  if (diff < 7 * 86400) return "week";
  return "older";
}

export const TIME_BUCKET_TITLE: Record<TimeBucket, string> = {
  today: "Сегодня",
  week: "На этой неделе",
  older: "Ранее",
};

/**
 * Bell dropdown groups: rows from the last 24h land in «Новые», older in
 * «Ранее». FB / VK use this exact split, and it works better than splitting
 * by read/unread because a row stays "новое" even after the user has
 * scanned the bell once.
 */
export type BellGroup = "new" | "earlier";

export function bellGroup(
  unix: number,
  now: number = Math.floor(Date.now() / 1000),
): BellGroup {
  return now - unix < 86400 ? "new" : "earlier";
}

export const BELL_GROUP_TITLE: Record<BellGroup, string> = {
  new: "Новые",
  earlier: "Ранее",
};
