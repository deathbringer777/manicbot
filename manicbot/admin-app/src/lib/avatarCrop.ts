/**
 * Avatar cropper — pure pixel math.
 *
 * The interactive cropper UI (Telegram-style: pan + zoom inside a circular
 * viewport) eventually has to bake what the user sees into a fixed-size
 * square output (1:1, then displayed under a `border-radius: 50%` mask).
 *
 * Splitting the math out of the React component lets us unit-test the
 * tricky bit — turning (scale, offsetX, offsetY) in CSS-pixel space into
 * a source rectangle in the image's natural pixel space — without
 * mounting a DOM.
 *
 * Coordinate model:
 *   * `viewportSize` is the diameter of the circular viewport in CSS px.
 *     The circle is always centred in the viewport. The viewport itself
 *     is a square; the circle is just a visual mask.
 *   * At `scale = 1`, the image is sized so its SHORTER side exactly
 *     matches `viewportSize` (i.e. the image covers the circle).
 *     Increasing scale zooms in.
 *   * `offsetX` / `offsetY` are in CSS px, measured from the viewport
 *     centre to the image centre. Positive `offsetX` means the user has
 *     dragged the image RIGHT (so the circle now sees more of the LEFT
 *     side of the source image).
 *
 * Note: `scale < 1` is rejected. The min-scale invariant keeps the
 * circle covered by image pixels — letting scale drop below 1 would
 * expose the viewport background through the round mask.
 */

export interface CropMathInput {
  naturalWidth: number;
  naturalHeight: number;
  viewportSize: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * CSS-px per image-px ratio at scale = 1 (the "image fits the circle on
 * its shorter side" baseline).
 */
export function baseImagePxPerCssPx(
  naturalWidth: number,
  naturalHeight: number,
  viewportSize: number,
): number {
  if (naturalWidth <= 0 || naturalHeight <= 0 || viewportSize <= 0) return 1;
  return Math.min(naturalWidth, naturalHeight) / viewportSize;
}

/**
 * The image's displayed size in CSS px at the given scale.
 */
export function displayedImageSize(
  input: Pick<CropMathInput, "naturalWidth" | "naturalHeight" | "viewportSize" | "scale">,
): { width: number; height: number } {
  const { naturalWidth, naturalHeight, viewportSize, scale } = input;
  const base = baseImagePxPerCssPx(naturalWidth, naturalHeight, viewportSize);
  if (base === 0) return { width: 0, height: 0 };
  return {
    width: (naturalWidth / base) * scale,
    height: (naturalHeight / base) * scale,
  };
}

/**
 * Largest allowed |offsetX| / |offsetY| (CSS px) that still keeps the
 * viewport circle entirely inside image pixels.
 *
 * Floors at 0 for the degenerate case where one dimension exactly fits
 * the viewport (e.g. a perfectly square image at scale = 1).
 */
export function maxOffsetRange(
  input: Pick<CropMathInput, "naturalWidth" | "naturalHeight" | "viewportSize" | "scale">,
): { x: number; y: number } {
  const { viewportSize } = input;
  const { width, height } = displayedImageSize(input);
  return {
    x: Math.max(0, (width - viewportSize) / 2),
    y: Math.max(0, (height - viewportSize) / 2),
  };
}

/**
 * Clamp an offset pair to the valid range for the given scale/image.
 * Used both during dragging and on save (defense-in-depth — if the
 * caller forgot to clamp during interaction, the output is still safe).
 */
export function clampOffset(input: CropMathInput): { offsetX: number; offsetY: number } {
  const range = maxOffsetRange(input);
  return {
    offsetX: Math.max(-range.x, Math.min(range.x, input.offsetX)),
    offsetY: Math.max(-range.y, Math.min(range.y, input.offsetY)),
  };
}

/**
 * Compute the source rectangle (in the image's natural pixel coords)
 * that drawImage(src, sx, sy, sw, sh, 0, 0, OUT, OUT) should pull from
 * to render the current viewport.
 *
 * Always clamps offsets first so a caller that lost track of the bounds
 * still gets a rectangle inside the image (no NaN, no negative-w
 * sub-pixels, no off-image reads).
 */
export function computeSourceRect(input: CropMathInput): SourceRect {
  const scale = Math.max(1, input.scale);
  const { offsetX, offsetY } = clampOffset({ ...input, scale });
  const base = baseImagePxPerCssPx(input.naturalWidth, input.naturalHeight, input.viewportSize);
  // At scale s, one CSS px on screen corresponds to (base / s) image px.
  const cropPxPerCssPx = base / scale;
  const sw = input.viewportSize * cropPxPerCssPx;
  const sh = sw; // 1:1 output — circle is a visual mask over a square crop.
  const cx = input.naturalWidth / 2 - offsetX * cropPxPerCssPx;
  const cy = input.naturalHeight / 2 - offsetY * cropPxPerCssPx;
  return { sx: cx - sw / 2, sy: cy - sh / 2, sw, sh };
}

/**
 * Render the cropped square to a 1:1 WebP File using the canvas APIs.
 *
 * Falls back to returning the original file when the runtime is missing
 * `createImageBitmap` / `OffscreenCanvas` (very old browsers) — the
 * server-side image validator still runs on the upload, so we never
 * accept an unverified payload.
 */
export async function renderCroppedFile(
  file: File,
  input: CropMathInput,
  outputSize = 512,
  quality = 0.9,
): Promise<File> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const rect = computeSourceRect({
    ...input,
    naturalWidth: bitmap.width,
    naturalHeight: bitmap.height,
  });
  const canvas = new OffscreenCanvas(outputSize, outputSize);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    return file;
  }
  ctx.drawImage(bitmap, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, outputSize, outputSize);
  bitmap.close?.();
  const blob = await canvas.convertToBlob({ type: "image/webp", quality });
  const name = file.name.replace(/\.[^.]+$/, ".webp");
  return new File([blob], name, { type: "image/webp" });
}
