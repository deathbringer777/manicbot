/**
 * Client avatar — shared constants for the picker in the Salon Clients tab.
 *
 * A client row has three possible avatar states:
 *   1. `avatarUrl` non-null → uploaded photo wins.
 *   2. `avatarEmoji` non-null → that emoji is displayed.
 *   3. both NULL → fall back to {@link DEFAULT_CLIENT_EMOJI}.
 *
 * The default is a woman's-head emoji (👩). Most operators run nail salons
 * where the typical client is a woman, so this matches the population
 * out of the box; if a salon's mix is different the operator overrides
 * per-client via the picker.
 *
 * Emojis are intentionally feminine + accessory-themed (crowns, tiaras,
 * flowers, hearts, sparkles, queens) to match the salon UX. Animals are
 * sprinkled in for variety since operators do tag VIP / loyal clients with
 * playful avatars in practice.
 */

export const DEFAULT_CLIENT_EMOJI = "👩";

/**
 * Curated emoji palette shown in the picker. Order matters — the first
 * entries are the most common picks (women + accessories), animals and
 * decorative motifs follow.
 *
 * Keep this list short (~40 items). A bigger grid hurts pickability — we
 * want fast scanning, not a full emoji keyboard.
 */
export const CLIENT_AVATAR_EMOJIS: readonly string[] = [
  // Women + queens + princesses + fairies + brides
  "👩", "👧", "🧒", "🧑", "👸", "🤴", "👰", "💁‍♀️", "🙋‍♀️", "🦸‍♀️",
  "🦹‍♀️", "🧚‍♀️", "🧝‍♀️", "🧞‍♀️", "🧜‍♀️", "💂‍♀️", "🕵️‍♀️",
  // Crowns + jewels + sparkles + bows
  "👑", "💎", "✨", "🌟", "⭐", "💫", "🎀", "🌈",
  // Flowers
  "🌸", "🌺", "🌷", "🌹", "🪷", "🌻", "🌼", "💐",
  // Hearts + lips
  "💖", "💕", "💜", "🤍", "🩷", "💋",
  // Playful animals
  "🦄", "🦋", "🐰", "🐱", "🦊", "🐼", "🦁",
];

/**
 * Pick the right emoji for display. Returns the saved value or the
 * default when null/empty.
 */
export function resolveAvatarEmoji(emoji: string | null | undefined): string {
  const trimmed = (emoji ?? "").trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_CLIENT_EMOJI;
}
