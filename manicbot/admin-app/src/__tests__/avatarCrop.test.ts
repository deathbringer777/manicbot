/**
 * Pure-math tests for the avatar cropper.
 *
 * The interactive cropper UI converts (scale, offsetX, offsetY) into a
 * canvas `drawImage` source rectangle. Bad math here = the saved photo
 * doesn't match what the user saw, which is the exact regression we're
 * about to ship a fix for. Test the math directly, no DOM.
 */
import { describe, it, expect } from "vitest";
import {
  baseImagePxPerCssPx,
  clampOffset,
  computeSourceRect,
  displayedImageSize,
  maxOffsetRange,
} from "~/lib/avatarCrop";

describe("baseImagePxPerCssPx", () => {
  it("returns shorter-side / viewport for landscape images", () => {
    expect(baseImagePxPerCssPx(1600, 1000, 320)).toBeCloseTo(1000 / 320);
  });

  it("returns shorter-side / viewport for portrait images", () => {
    expect(baseImagePxPerCssPx(800, 2000, 320)).toBeCloseTo(800 / 320);
  });

  it("returns 1 for invalid input (no division by zero)", () => {
    expect(baseImagePxPerCssPx(0, 100, 320)).toBe(1);
    expect(baseImagePxPerCssPx(100, 0, 320)).toBe(1);
    expect(baseImagePxPerCssPx(100, 100, 0)).toBe(1);
  });
});

describe("displayedImageSize", () => {
  it("at scale 1, the shorter side equals the viewport", () => {
    const { width, height } = displayedImageSize({
      naturalWidth: 1600,
      naturalHeight: 1000,
      viewportSize: 320,
      scale: 1,
    });
    expect(height).toBeCloseTo(320);
    expect(width).toBeCloseTo((1600 * 320) / 1000);
  });

  it("scales linearly with `scale`", () => {
    const at1 = displayedImageSize({
      naturalWidth: 1000,
      naturalHeight: 1000,
      viewportSize: 320,
      scale: 1,
    });
    const at2 = displayedImageSize({
      naturalWidth: 1000,
      naturalHeight: 1000,
      viewportSize: 320,
      scale: 2,
    });
    expect(at2.width).toBeCloseTo(at1.width * 2);
    expect(at2.height).toBeCloseTo(at1.height * 2);
  });
});

describe("maxOffsetRange", () => {
  it("perfectly-square image at scale 1 has zero drag room (circle == image)", () => {
    const r = maxOffsetRange({
      naturalWidth: 800,
      naturalHeight: 800,
      viewportSize: 320,
      scale: 1,
    });
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it("landscape image at scale 1: horizontal drag room only", () => {
    const r = maxOffsetRange({
      naturalWidth: 1600,
      naturalHeight: 1000,
      viewportSize: 320,
      scale: 1,
    });
    // displayedWidth = 1600 * 320 / 1000 = 512 → max |x| = (512 - 320) / 2 = 96
    expect(r.x).toBeCloseTo(96);
    expect(r.y).toBe(0);
  });

  it("never returns negative bounds", () => {
    // Hypothetical edge: viewportSize > both sides (image smaller than
    // the viewport — UI prevents this via min-scale, but the math must
    // still be safe).
    const r = maxOffsetRange({
      naturalWidth: 100,
      naturalHeight: 100,
      viewportSize: 320,
      scale: 1,
    });
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });
});

describe("clampOffset", () => {
  it("clamps |offsetX| to the horizontal range", () => {
    const { offsetX, offsetY } = clampOffset({
      naturalWidth: 1600,
      naturalHeight: 1000,
      viewportSize: 320,
      scale: 1,
      offsetX: 500,
      offsetY: 500,
    });
    expect(offsetX).toBeCloseTo(96);
    expect(offsetY).toBe(0);
  });

  it("clamps negative offsets symmetrically", () => {
    const { offsetX, offsetY } = clampOffset({
      naturalWidth: 1600,
      naturalHeight: 1000,
      viewportSize: 320,
      scale: 1,
      offsetX: -500,
      offsetY: -500,
    });
    expect(offsetX).toBeCloseTo(-96);
    expect(Math.abs(offsetY)).toBe(0); // -0 / +0 both fine here
  });

  it("passes through in-range offsets unchanged", () => {
    const { offsetX, offsetY } = clampOffset({
      naturalWidth: 1600,
      naturalHeight: 1000,
      viewportSize: 320,
      scale: 1,
      offsetX: 50,
      offsetY: 0,
    });
    expect(offsetX).toBe(50);
    expect(offsetY).toBe(0);
  });
});

describe("computeSourceRect", () => {
  it("centred + scale 1 returns the centre square (legacy auto-crop)", () => {
    const r = computeSourceRect({
      naturalWidth: 1600,
      naturalHeight: 1000,
      viewportSize: 320,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    // Shorter side is 1000 → centre square is 1000×1000 starting at x=300.
    expect(r.sw).toBeCloseTo(1000);
    expect(r.sh).toBeCloseTo(1000);
    expect(r.sx).toBeCloseTo(300);
    expect(r.sy).toBeCloseTo(0);
  });

  it("scale 2 halves the source size", () => {
    const r = computeSourceRect({
      naturalWidth: 1000,
      naturalHeight: 1000,
      viewportSize: 320,
      scale: 2,
      offsetX: 0,
      offsetY: 0,
    });
    expect(r.sw).toBeCloseTo(500);
    expect(r.sh).toBeCloseTo(500);
    expect(r.sx).toBeCloseTo(250);
    expect(r.sy).toBeCloseTo(250);
  });

  it("dragging RIGHT shifts the source LEFT in image coords", () => {
    // 1600×1000, scale 1. base = 1000/320. 96 CSS px right ⇒
    // 96 * (1000/320) = 300 image-px shift left. Centre was at x=800,
    // so new centre = 500, and sx = 500 - 500 = 0.
    const r = computeSourceRect({
      naturalWidth: 1600,
      naturalHeight: 1000,
      viewportSize: 320,
      scale: 1,
      offsetX: 96,
      offsetY: 0,
    });
    expect(r.sx).toBeCloseTo(0);
  });

  it("rejects scale < 1 (clamps to 1)", () => {
    const r = computeSourceRect({
      naturalWidth: 1000,
      naturalHeight: 1000,
      viewportSize: 320,
      scale: 0.5,
      offsetX: 0,
      offsetY: 0,
    });
    // At scale 1, source is the full 1000×1000 square.
    expect(r.sw).toBeCloseTo(1000);
    expect(r.sx).toBeCloseTo(0);
  });

  it("clamps overshoot offsets so the rect stays inside the image", () => {
    const r = computeSourceRect({
      naturalWidth: 1600,
      naturalHeight: 1000,
      viewportSize: 320,
      scale: 1,
      offsetX: 99_999, // user dragged way past the bound
      offsetY: 0,
    });
    expect(r.sx).toBeGreaterThanOrEqual(0);
    expect(r.sx + r.sw).toBeLessThanOrEqual(1600 + 1e-6);
  });

  it("scale 2 + offset still lands inside the image (clamped properly)", () => {
    const r = computeSourceRect({
      naturalWidth: 1000,
      naturalHeight: 1000,
      viewportSize: 320,
      scale: 2,
      offsetX: 99_999,
      offsetY: 0,
    });
    // At scale 2 on 1000×1000, displayedW = 320*1 (base) * 2 / ... let
    // me just assert containment.
    expect(r.sx).toBeGreaterThanOrEqual(0);
    expect(r.sx + r.sw).toBeLessThanOrEqual(1000 + 1e-6);
    expect(r.sy).toBeGreaterThanOrEqual(0);
    expect(r.sy + r.sh).toBeLessThanOrEqual(1000 + 1e-6);
  });
});
