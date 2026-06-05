/**
 * Clamp a calendar block's pixel geometry to the visible hour window.
 *
 * Absolute-positioned blocks don't grow their column, but they DO extend a
 * scroll container's scrollable region. An over-long single-day block (e.g. a
 * 24h "day off" stored as duration_min=1440) therefore stretched the grid's
 * scroll area far below working hours, leaving a large empty void in every
 * other column. The visible hour window — not the block — must define how far
 * the grid scrolls, so we pin every block band to [0, totalPx].
 *
 * @param rawTop    block top in px (may be negative if it starts before the window)
 * @param rawHeight block height in px (raw duration height)
 * @param totalPx   the grid's visible height = totalHours * HOUR_HEIGHT
 * @returns clamped { top, height }; height === 0 means the block is entirely
 *          outside the window and the caller should skip rendering it.
 */
export function clampBand(
  rawTop: number,
  rawHeight: number,
  totalPx: number,
): { top: number; height: number } {
  const top = Math.max(0, Math.min(rawTop, totalPx));
  const bottom = Math.min(rawTop + rawHeight, totalPx);
  const height = Math.max(0, bottom - top);
  return { top, height };
}
