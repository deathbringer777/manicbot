/**
 * Client-side helpers for uploading chat attachments (ticket replies +
 * messenger messages) to the Worker's `/upload/asset` endpoint.
 *
 * Flow:
 *   1. Caller mints a fresh token via the relevant tRPC mutation
 *      (`support.mintTicketUploadToken` or `messenger.mintAttachmentUploadToken`).
 *      Token is single-use-ish (5-min TTL, content-addressed key — re-uploads
 *      of identical bytes write the same R2 object).
 *   2. Caller invokes `uploadChatAttachment(file, uploadUrl)` here, which
 *      POSTs a multipart form to the Worker.
 *   3. Worker validates token + MIME + size + magic bytes, writes to R2,
 *      returns `{ ok: true, key, url }`. We return the `url`.
 *
 * The Worker accepts PNG / JPEG / WEBP up to 2 MB. We intercept oversize
 * / wrong-type / decode-failure cases here so the user gets an immediate
 * inline message rather than a 4xx after a slow upload round-trip.
 */

export const CHAT_ATTACHMENT_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export const CHAT_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB — matches Worker

/** Localized error codes returned by upload paths. */
export type ChatAttachmentError =
  | "unsupported_type"
  | "too_large"
  | "token_mint_failed"
  | "upload_failed"
  | "network_error";

export class ChatAttachmentUploadError extends Error {
  code: ChatAttachmentError;
  constructor(code: ChatAttachmentError, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

/**
 * Reject early when a file is the wrong type or oversize. Returns null on
 * success, an error code on failure.
 */
export function validateChatAttachmentFile(file: File): ChatAttachmentError | null {
  if (!CHAT_ATTACHMENT_ALLOWED_MIME.has(file.type)) return "unsupported_type";
  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) return "too_large";
  return null;
}

/**
 * Upload one file to the Worker. `uploadUrl` MUST come from a freshly-minted
 * tRPC token call — never hard-coded, never reused after success.
 */
export async function uploadChatAttachment(
  file: File,
  uploadUrl: string,
): Promise<string> {
  const validation = validateChatAttachmentFile(file);
  if (validation) throw new ChatAttachmentUploadError(validation);

  const form = new FormData();
  form.append("file", file);

  let resp: Response;
  try {
    resp = await fetch(uploadUrl, { method: "POST", body: form });
  } catch {
    throw new ChatAttachmentUploadError("network_error");
  }

  if (!resp.ok) {
    throw new ChatAttachmentUploadError("upload_failed", `HTTP ${resp.status}`);
  }

  let data: { ok: boolean; url?: string; error?: string } | null;
  try {
    data = (await resp.json()) as typeof data;
  } catch {
    throw new ChatAttachmentUploadError("upload_failed", "Invalid JSON response");
  }

  if (!data?.ok || !data.url) {
    throw new ChatAttachmentUploadError("upload_failed", data?.error ?? "Worker rejected");
  }
  return data.url;
}

/** User-facing message for each error code, in Russian (UI language). */
export function describeChatAttachmentError(code: ChatAttachmentError): string {
  switch (code) {
    case "unsupported_type":
      return "Поддерживаются только PNG, JPEG, WEBP";
    case "too_large":
      return "Файл больше 2 МБ — сожмите изображение";
    case "token_mint_failed":
      return "Не удалось получить разрешение на загрузку";
    case "upload_failed":
      return "Сервер отклонил загрузку";
    case "network_error":
      return "Сеть не дотянулась до сервера";
  }
}

/**
 * Extract files from a paste event (clipboard image) or drag-drop event.
 * Returns an empty array if no image files were attached.
 */
export function filesFromPasteEvent(e: ClipboardEvent): File[] {
  const items = e.clipboardData?.items;
  if (!items) return [];
  const files: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

export function filesFromDropEvent(e: DragEvent): File[] {
  const fl = e.dataTransfer?.files;
  if (!fl || fl.length === 0) return [];
  return Array.from(fl);
}
