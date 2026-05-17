/**
 * clientAvatar helper — locks the contract used by the picker + row.
 *
 * The render logic in `ClientRow` / `ClientDetailModal` calls
 * `resolveAvatarEmoji(c.avatarEmoji)`. Whatever this returns is rendered as
 * the user-facing fallback when no photo is uploaded. A regression in this
 * helper would make every client without a custom emoji render as an empty
 * circle — worse UX than the legacy initials chip.
 */
import { describe, it, expect } from "vitest";
import {
  CLIENT_AVATAR_EMOJIS,
  DEFAULT_CLIENT_EMOJI,
  resolveAvatarEmoji,
} from "~/lib/clientAvatar";

describe("clientAvatar helpers", () => {
  it("default emoji is a woman's-head emoji", () => {
    expect(DEFAULT_CLIENT_EMOJI).toBe("👩");
  });

  it("default emoji appears in the picker palette", () => {
    expect(CLIENT_AVATAR_EMOJIS).toContain(DEFAULT_CLIENT_EMOJI);
  });

  it("palette includes crown + princess + tiara-relevant icons", () => {
    expect(CLIENT_AVATAR_EMOJIS).toContain("👑");
    expect(CLIENT_AVATAR_EMOJIS).toContain("👸");
  });

  it("palette has at least 30 entries and no duplicates", () => {
    expect(CLIENT_AVATAR_EMOJIS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(CLIENT_AVATAR_EMOJIS).size).toBe(CLIENT_AVATAR_EMOJIS.length);
  });

  it("resolveAvatarEmoji returns the default for null / undefined / empty", () => {
    expect(resolveAvatarEmoji(null)).toBe(DEFAULT_CLIENT_EMOJI);
    expect(resolveAvatarEmoji(undefined)).toBe(DEFAULT_CLIENT_EMOJI);
    expect(resolveAvatarEmoji("")).toBe(DEFAULT_CLIENT_EMOJI);
    expect(resolveAvatarEmoji("   ")).toBe(DEFAULT_CLIENT_EMOJI);
  });

  it("resolveAvatarEmoji preserves a saved emoji verbatim", () => {
    expect(resolveAvatarEmoji("👸")).toBe("👸");
    expect(resolveAvatarEmoji("🦄")).toBe("🦄");
  });
});
