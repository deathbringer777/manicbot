/**
 * Shared appointment constants used across dashboard components.
 * Single source of truth — import from here, never redefine locally.
 */

export const STATUS_LABELS: Record<string, string> = {
  pending: "Ожидание",
  confirmed: "Подтверждено",
  rejected: "Отклонено",
  cancelled: "Отменено",
  done: "Выполнено",
  counter_offer: "Встречное",
  no_show: "Не пришёл",
};

export const APT_BORDER: Record<string, string> = {
  confirmed: "border-l-emerald-500",
  pending:   "border-l-amber-400",
  cancelled: "border-l-red-500/40",
  rejected:  "border-l-red-500/40",
  no_show:   "border-l-orange-500/40",
  done:      "border-l-brand-500",
};

export const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  pending:   "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  cancelled: "bg-red-500/15 text-red-400 border border-red-500/20",
  rejected:  "bg-red-500/15 text-red-400 border border-red-500/20",
  no_show:   "bg-orange-500/15 text-orange-400 border border-orange-500/20",
  done:      "bg-brand-500/15 text-brand-400 border border-brand-500/20",
};

export const NAIL_EMOJIS: string[] = [
  '💅','💆','💇','✂️','🪮','🌸','✨','💎','🌺','🫧',
  '🧴','🧼','🪷','💜','🤍','🎀','🫶','⭐','🌟','💫',
  '🎨','🌷','🪸','🫐','🍒',
];

/** Relative time formatter (seconds-based, Russian labels). */
export function relativeTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return `${Math.floor(diff / 86400)} д назад`;
}
