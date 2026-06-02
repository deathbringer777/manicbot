"use client";

/**
 * BrandTile — the small square in the sidebar/header that shows the brand.
 *
 * Render priority (per current role):
 *   1. Master: master.avatarUrl > master.avatarEmoji > tenant.logo > 💅
 *   2. Tenant owner / manager:   tenant.logo > 💅
 *   3. System admin / support:   💅 (no personal salon)
 *
 * The tile background is theme-aware (`bg-surface-muted dark:bg-white/[0.06]`)
 * so the glyph reads on both light and dark sidebars. When a photo URL is
 * present we render it edge-to-edge inside the rounded tile so the user's
 * upload feels like a real avatar, not an icon sitting inside a chip.
 */

import { useRole } from "~/components/RoleContext";

interface Props {
  /** Tailwind size + radius classes for the outer tile (e.g. "h-8 w-8 rounded-lg"). */
  className?: string;
  /** Override text size of the emoji glyph. Default sized for 32px tile. */
  glyphClassName?: string;
}

export function BrandTile({
  className = "h-8 w-8 rounded-lg",
  glyphClassName = "text-base",
}: Props) {
  const { role, tenantLogo, masterAvatarUrl, masterAvatarEmoji } = useRole();

  // Resolve the glyph by role + available data.
  // Master priority: own photo → own emoji → tenant logo → 💅.
  // The master's own emoji wins over the salon logo so a master who
  // deliberately picked a personal glyph isn't overridden by the salon's
  // brand image.
  const isMaster = role === "master";
  const isTenantUser = role === "tenant_owner" || role === "tenant_manager";

  let photoUrl: string | null = null;
  let emoji: string | null = null;
  if (isMaster) {
    if (masterAvatarUrl) photoUrl = masterAvatarUrl;
    else if (masterAvatarEmoji) emoji = masterAvatarEmoji;
    else if (tenantLogo) photoUrl = tenantLogo;
  } else if (isTenantUser) {
    photoUrl = tenantLogo ?? null;
  }

  // Photo path: render the image edge-to-edge inside the tile, no chip bg.
  if (photoUrl) {
    return (
      <div
        className={`relative overflow-hidden shrink-0 ${className}`}
        data-testid="brand-tile-photo"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
    );
  }

  // Emoji / fallback path: glyph centered on a neutral elevated surface
  // matching the rest of the sidebar's icon buttons.
  return (
    <div
      className={`flex items-center justify-center bg-surface-muted dark:bg-white/[0.06] shrink-0 ${className}`}
      data-testid="brand-tile-glyph"
    >
      <span
        className={`${glyphClassName} leading-none select-none`}
        role="img"
        aria-label="ManicBot"
      >
        {emoji ?? "💅"}
      </span>
    </div>
  );
}
