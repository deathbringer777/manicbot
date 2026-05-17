"use client";

import { useRef, useState } from "react";
import { Paperclip, Loader2 } from "lucide-react";
import {
  uploadChatAttachment,
  validateChatAttachmentFile,
  describeChatAttachmentError,
  ChatAttachmentUploadError,
  CHAT_ATTACHMENT_ALLOWED_MIME,
} from "~/lib/chatAttachments";

interface Props {
  /**
   * Mints a fresh upload token + URL via the relevant tRPC mutation
   * (`support.mintTicketUploadToken` for tickets,
   * `messenger.mintAttachmentUploadToken` for the messenger).
   * Each upload mints its own token — never reuse.
   */
  mintToken: () => Promise<{ token: string; uploadUrl: string }>;
  /** Called with the public CDN URL after successful upload. */
  onUploaded: (url: string) => void;
  /** Called with a localized error message on any failure. */
  onError?: (message: string) => void;
  disabled?: boolean;
  /** Tooltip / aria-label override. Default: "Прикрепить изображение". */
  title?: string;
}

/**
 * Compact paperclip icon-button that opens a file picker, uploads the chosen
 * image to the Worker via a freshly-minted token, and surfaces the resulting
 * CDN URL through `onUploaded`. Internal state covers the in-flight spinner
 * and inline error pill.
 *
 * Drag-and-drop and clipboard paste are handled by the parent composer via
 * the `uploadChatAttachment` helper directly — this button is only the click
 * affordance.
 */
export function ChatAttachButton({ mintToken, onUploaded, onError, disabled, title }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    const validation = validateChatAttachmentFile(file);
    if (validation) {
      onError?.(describeChatAttachmentError(validation));
      return;
    }
    setUploading(true);
    try {
      const { uploadUrl } = await mintToken();
      const url = await uploadChatAttachment(file, uploadUrl);
      onUploaded(url);
    } catch (e) {
      const message =
        e instanceof ChatAttachmentUploadError
          ? describeChatAttachmentError(e.code)
          : "Не удалось загрузить файл";
      onError?.(message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={Array.from(CHAT_ATTACHMENT_ALLOWED_MIME).join(",")}
        className="hidden"
        data-testid="chat-attach-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      <button
        type="button"
        title={title ?? "Прикрепить изображение"}
        aria-label={title ?? "Прикрепить изображение"}
        data-testid="chat-attach-button"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
      </button>
    </>
  );
}
