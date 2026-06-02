/**
 * Client-side helpers for uploading salon branding assets to the Worker's
 * /upload/asset endpoint.
 *
 * Flow:
 *   1. Call `api.salon.mintUploadToken.mutate({ tenantId, kind })` → { token, uploadUrl }
 *   2. Call `uploadAssetFile(uploadUrl, file)` → { key, url }
 *   3. Save `url` + `key` to the tenant via `api.salon.updateSalonProfile.mutate(...)`
 */

export type UploadKind = "logo" | "cover" | "background" | "photo" | "portfolio" | "service_photo" | "client_avatar" | "cancellation_feedback";

export interface UploadResult {
  ok: true;
  key: string;
  url: string;
}

export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const UPLOAD_ACCEPT_MIME = ["image/png", "image/jpeg", "image/webp"] as const;

/**
 * POST a file to the Worker's /upload/asset endpoint with a pre-signed token.
 * Throws on any non-2xx response; returns `{ key, url }` on success.
 */
export async function uploadAssetFile(uploadUrl: string, file: File | Blob): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch(uploadUrl, { method: "POST", body: form });
  if (!resp.ok) {
    let msg = `Upload failed (${resp.status})`;
    try {
      const data = (await resp.json()) as { error?: string };
      if (data?.error) msg = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await resp.json()) as UploadResult;
}

/**
 * Resize an image file client-side before upload. Returns a PNG blob at most
 * `maxDim` pixels on the longest edge, preserving aspect ratio. If the browser
 * doesn't support canvas / createImageBitmap, returns the original file unchanged.
 *
 * This is best-effort bandwidth/storage optimization — the server still enforces
 * its own size/MIME checks.
 */
export async function resizeImageClientSide(
  file: File,
  maxDim = 1024,
  outputType: "image/png" | "image/jpeg" | "image/webp" = "image/webp",
  quality = 0.9,
): Promise<File> {
  try {
    if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
      return file;
    }
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    if (scale >= 1 && file.size <= UPLOAD_MAX_BYTES) return file; // already small enough
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: outputType, quality });
    const ext = outputType === "image/jpeg" ? "jpg" : outputType === "image/webp" ? "webp" : "png";
    const name = file.name.replace(/\.[^.]+$/, `.${ext}`);
    return new File([blob], name, { type: outputType });
  } catch {
    return file;
  }
}

export function validateUploadFile(file: File): string | null {
  if (!file) return "No file selected";
  if (file.size === 0) return "File is empty";
  if (file.size > UPLOAD_MAX_BYTES) {
    return `File is too large (max ${Math.round(UPLOAD_MAX_BYTES / 1024 / 1024)} MB)`;
  }
  if (!UPLOAD_ACCEPT_MIME.includes(file.type as (typeof UPLOAD_ACCEPT_MIME)[number])) {
    return `Unsupported format (${file.type || "unknown"}). Use PNG, JPEG, or WebP.`;
  }
  return null;
}
