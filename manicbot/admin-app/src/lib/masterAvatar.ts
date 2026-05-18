/**
 * Master avatar — shared constants for the picker in MasterDetailModal.
 *
 * A master row has three possible avatar states:
 *   1. `avatarUrl` non-null → uploaded photo wins.
 *   2. `avatarEmoji` non-null → that emoji is displayed.
 *   3. both NULL → fall back to {@link DEFAULT_MASTER_EMOJI}.
 *
 * The default is 💅 (nail polish) — immediately recognisable in the
 * nail-salon context and distinct from the client default (👩).
 */

export const DEFAULT_MASTER_EMOJI = "💅";

/**
 * Curated emoji palette for the master avatar picker. Skews toward
 * artistic / professional / beauty-salon themes while retaining the
 * fun tone operators expect.
 */
export const MASTER_AVATAR_EMOJIS: readonly string[] = [
  // Nail / beauty craft
  "💅", "🖌️", "✂️", "💇‍♀️", "💆‍♀️", "🪮", "🎨", "🧴",
  // Women + artists + queens
  "👩", "🧑", "👸", "🤴", "💁‍♀️", "🙋‍♀️", "🧚‍♀️", "🦸‍♀️",
  // Crowns + sparkles + jewels
  "👑", "💎", "✨", "🌟", "⭐", "💫", "🎀", "🌈",
  // Flowers
  "🌸", "🌺", "🌷", "🌹", "🪷", "🌻", "🌼", "💐",
  // Hearts + lips
  "💖", "💕", "💜", "🤍", "🩷", "💋",
  // Playful animals
  "🦄", "🦋", "🐱", "🦊", "🐼",
];

/**
 * Pick the right emoji for display. Returns the saved value or the
 * default when null/empty.
 */
export function resolveMasterAvatarEmoji(emoji: string | null | undefined): string {
  const trimmed = (emoji ?? "").trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_MASTER_EMOJI;
}
