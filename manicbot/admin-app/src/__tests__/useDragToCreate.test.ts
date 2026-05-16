/**
 * useDragToCreate — pure geometry math (snap, yToMinutes, minutesToY,
 * minutesToHHMM). The pointer-event part is exercised in
 * `DragCreateLayer.test.tsx`; this file just pins the math so a future
 * tweak to snap or hour origin can't silently shift booked times.
 */
import { describe, it, expect } from "vitest";
import { yToMinutes, minutesToY, minutesToHHMM } from "~/lib/calendar/useDragToCreate";

describe("useDragToCreate — geometry helpers", () => {
  // hourHeight=48, hourStart=8 → y=0 corresponds to 08:00.
  const HH = 48;
  const HS = 8;

  describe("yToMinutes", () => {
    it("y=0 maps to hourStart * 60 (480 minutes)", () => {
      expect(yToMinutes(0, HH, HS, 15)).toBe(480);
    });

    it("snaps to 15-min increments", () => {
      // Exactly 60 minutes worth of px from start = 09:00 = 540
      expect(yToMinutes(HH, HH, HS, 15)).toBe(540);
      // 1 px past start should snap to 480 (00 mins)
      expect(yToMinutes(1, HH, HS, 15)).toBe(480);
      // 12 px past start = 15 min (60 / 48 * 12 = 15) → snaps to 495
      expect(yToMinutes(12, HH, HS, 15)).toBe(495);
    });

    it("snaps to 30-min increments when snapMin=30", () => {
      // 12 px past start = 15 min, raw total 495 → snaps to 510 (nearest 30,
      // ties round up via Math.round at .5 boundary).
      expect(yToMinutes(12, HH, HS, 30)).toBe(510);
      // 24 px past start = 30 min, raw total 510 → already on a 30-min boundary.
      expect(yToMinutes(24, HH, HS, 30)).toBe(510);
    });

    it("never returns a negative minute (clamps non-negative)", () => {
      // Way-negative y (which our pointer capture prevents in practice) →
      // raw minutes go negative, then clamp to 0.
      expect(yToMinutes(-1000, HH, HS, 15)).toBe(0);
    });
  });

  describe("minutesToY", () => {
    it("hourStart * 60 maps to y=0", () => {
      expect(minutesToY(480, HH, HS)).toBe(0);
    });

    it("each hour past start contributes hourHeight px", () => {
      expect(minutesToY(540, HH, HS)).toBe(48);
      expect(minutesToY(600, HH, HS)).toBe(96);
    });

    it("round-trips with yToMinutes", () => {
      for (const min of [480, 510, 540, 600, 660, 720, 1080]) {
        expect(yToMinutes(minutesToY(min, HH, HS), HH, HS, 15)).toBe(min);
      }
    });
  });

  describe("minutesToHHMM", () => {
    it("formats to zero-padded HH:MM", () => {
      expect(minutesToHHMM(0)).toBe("00:00");
      expect(minutesToHHMM(60)).toBe("01:00");
      expect(minutesToHHMM(75)).toBe("01:15");
      expect(minutesToHHMM(540)).toBe("09:00");
      expect(minutesToHHMM(1395)).toBe("23:15");
    });
  });
});
