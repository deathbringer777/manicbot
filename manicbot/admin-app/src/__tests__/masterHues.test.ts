/**
 * Pins the shared master-hue palettes (DC-6 dedup) byte-for-byte against the
 * five original hand-copied literals, so the refactor provably changes zero
 * pixels on any calendar surface.
 */
import { describe, it, expect } from "vitest";
import {
  MASTER_BLOCK_PALETTE,
  MASTER_RAIL_PALETTE,
  MASTER_ACCENT_PALETTE,
} from "~/lib/calendar/masterHues";

// Verbatim copies of the pre-dedup constants.
const ORIG_BLOCK = [
  { bg: "rgba(124,58,237,0.18)", border: "rgba(124,58,237,0.55)", text: "#7c3aed" },
  { bg: "rgba(11,155,107,0.18)", border: "rgba(11,155,107,0.55)", text: "#0b9b6b" },
  { bg: "rgba(6,182,212,0.18)", border: "rgba(6,182,212,0.55)", text: "#0891b2" },
  { bg: "rgba(244,114,182,0.18)", border: "rgba(244,114,182,0.55)", text: "#ec4899" },
  { bg: "rgba(245,158,11,0.18)", border: "rgba(245,158,11,0.55)", text: "#d97706" },
  { bg: "rgba(59,130,246,0.18)", border: "rgba(59,130,246,0.55)", text: "#2563eb" },
  { bg: "rgba(168,85,247,0.18)", border: "rgba(168,85,247,0.55)", text: "#9333ea" },
  { bg: "rgba(20,184,166,0.18)", border: "rgba(20,184,166,0.55)", text: "#0d9488" },
];
const ORIG_RAIL = [
  { dot: "#7c3aed", bg: "rgba(124,58,237,0.15)" },
  { dot: "#0b9b6b", bg: "rgba(11,155,107,0.15)" },
  { dot: "#0891b2", bg: "rgba(6,182,212,0.15)" },
  { dot: "#ec4899", bg: "rgba(244,114,182,0.15)" },
  { dot: "#d97706", bg: "rgba(245,158,11,0.15)" },
  { dot: "#2563eb", bg: "rgba(59,130,246,0.15)" },
  { dot: "#9333ea", bg: "rgba(168,85,247,0.15)" },
  { dot: "#0d9488", bg: "rgba(20,184,166,0.15)" },
];
const ORIG_ACCENT = ["#7c3aed", "#0b9b6b", "#0891b2", "#ec4899", "#d97706", "#2563eb", "#9333ea", "#0d9488"];

describe("master-hue dedup (DC-6) — derived palettes match the originals", () => {
  it("block palette (Day/Week) is byte-identical", () => {
    expect(MASTER_BLOCK_PALETTE.map((x) => ({ ...x }))).toEqual(ORIG_BLOCK);
  });
  it("rail palette is byte-identical", () => {
    expect(MASTER_RAIL_PALETTE.map((x) => ({ ...x }))).toEqual(ORIG_RAIL);
  });
  it("accent palette (Agenda/Month) is byte-identical", () => {
    expect([...MASTER_ACCENT_PALETTE]).toEqual(ORIG_ACCENT);
  });
});
