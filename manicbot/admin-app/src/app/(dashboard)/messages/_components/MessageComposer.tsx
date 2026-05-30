"use client";

import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { Send, StickyNote, AlertTriangle, Loader2, X } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { ChatAttachButton } from "~/components/chat/ChatAttachButton";
import {
  uploadChatAttachment,
  validateChatAttachmentFile,
  describeChatAttachmentError,
  ChatAttachmentUploadError,
} from "~/lib/chatAttachments";

const MAX_ATTACHMENTS = 4;

/**
 * Sentinel body stored for attachment-only messages (no text). Shared with
 * ThreadView (which hides it on display) so writer and reader never drift.
 * NOTE: stored value — changing it orphans the display-hide for historical rows.
 */
export const ATTACHMENT_ONLY_BODY = "(вложение)";

function describeRelayError(code: string, lang: Parameters<typeof t>[1]): string {
  switch (code) {
    case "outside_message_window":              return t("messenger.relay.outsideWindow", lang);
    case "channel_token_unavailable":           return t("messenger.relay.tokenUnavailable", lang);
    case "channel_send_failed":                 return t("messenger.relay.channelFailed", lang);
    case "thread_not_found_or_not_client_conv": return t("messenger.relay.notClientConv", lang);
    case "channel_not_supported":               return t("messenger.relay.notSupported", lang);
    case "relay_not_configured":                return "Relay not configured on server";
    case "relay_network_error":                 return t("messenger.relay.networkError", lang);
    default: return code;
  }
}

interface Props {
  tenantId: string;
  threadId: string;
  threadKind: string;
  disabled?: boolean;
  onSent?: () => void;
}

export function MessageComposer({ tenantId, threadId, threadKind, disabled, onSent }: Props) {
  const [body, setBody] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [pasteUploading, setPasteUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const utils = api.useUtils();
  const { lang } = useLang();

  const sendMutation = api.messenger.sendMessage.useMutation({
    onSuccess: async (result) => {
      setBody("");
      setAttachments([]);
      setAttachmentError(null);
      setRelayError(result.relay && !result.relay.ok ? result.relay.error : null);
      // Refresh thread + inbox
      await Promise.all([
        utils.messenger.getThread.invalidate({ tenantId, threadId }),
        utils.messenger.listThreads.invalidate({ tenantId }),
      ]);
      onSent?.();
      taRef.current?.focus();
    },
  });

  const mintTokenMut = api.messenger.mintAttachmentUploadToken.useMutation();

  async function mintTokenForThread() {
    return await mintTokenMut.mutateAsync({ tenantId, threadId });
  }

  async function uploadOne(file: File) {
    if (attachments.length >= MAX_ATTACHMENTS) {
      setAttachmentError(`Max ${MAX_ATTACHMENTS} attachments`);
      return;
    }
    const validation = validateChatAttachmentFile(file);
    if (validation) {
      setAttachmentError(describeChatAttachmentError(validation));
      return;
    }
    setAttachmentError(null);
    setPasteUploading(true);
    try {
      const { uploadUrl } = await mintTokenForThread();
      const url = await uploadChatAttachment(file, uploadUrl);
      setAttachments((prev) => [...prev, url]);
    } catch (e) {
      const code = e instanceof ChatAttachmentUploadError ? e.code : "upload_failed";
      setAttachmentError(describeChatAttachmentError(code as never));
    } finally {
      setPasteUploading(false);
    }
  }

  function submit() {
    const trimmed = body.trim();
    if (sendMutation.isPending || disabled) return;
    // Allow attachment-only submits.
    if (!trimmed && attachments.length === 0) return;
    sendMutation.mutate({
      tenantId,
      threadId,
      body: trimmed || ATTACHMENT_ONLY_BODY,
      isInternalNote: threadKind === "client_conv" ? isInternalNote : false,
      attachments:
        attachments.length > 0
          ? attachments.map((url) => ({ url, kind: "image" as const }))
          : undefined,
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          void uploadOne(f);
          return;
        }
      }
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer?.files;
    if (!files) return;
    // Multiple files OK up to MAX_ATTACHMENTS — uploadOne self-guards.
    for (let i = 0; i < files.length; i++) {
      void uploadOne(files[i]!);
    }
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      setIsDragging(true);
    }
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  const isClientConv = threadKind === "client_conv";
  const isSystem = threadKind === "system";

  if (isSystem) {
    return (
      <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 px-3 py-2 text-center text-[11px] text-slate-500">
        {t("messenger.composer.systemReadonly", lang)}
      </div>
    );
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
      className={`border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-colors ${
        isDragging ? "ring-2 ring-brand-500/60 ring-inset" : ""
      }`}
    >
      {isClientConv && (
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setIsInternalNote((v) => !v)}
            data-testid="internal-note-toggle"
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
              isInternalNote
                ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <StickyNote className="h-3 w-3" />
            {isInternalNote
              ? t("messenger.composer.internalNote", lang)
              : t("messenger.composer.normalMessage", lang)}
          </button>
          {isInternalNote && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400">
              {t("messenger.composer.clientHidden", lang)}
            </span>
          )}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
          {attachments.map((url, idx) => (
            <div
              key={`${url}-${idx}`}
              className="relative h-16 w-16 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              data-testid="attachment-preview"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeAttachment(idx)}
                className="absolute right-0.5 top-0.5 rounded-full bg-slate-900/70 p-0.5 text-white hover:bg-slate-900"
                aria-label={t("messenger.composer.removeAttachment", lang)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {pasteUploading && (
            <div className="h-16 w-16 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
            </div>
          )}
        </div>
      )}
      {attachments.length === 0 && pasteUploading && (
        <p className="px-3 pt-2 text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("messenger.composer.uploading", lang)}
        </p>
      )}
      {attachmentError && (
        <p className="px-3 pt-2 text-[10px] text-red-500" data-testid="attachment-error">
          {attachmentError}
        </p>
      )}

      <div className="flex items-end gap-2 p-2">
        <textarea
          ref={taRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={1}
          placeholder={
            isInternalNote
              ? t("messenger.composer.placeholderNote", lang)
              : isClientConv
                ? t("messenger.composer.placeholderClient", lang)
                : t("messenger.composer.placeholderDefault", lang)
          }
          data-testid="message-composer-input"
          disabled={disabled || sendMutation.isPending}
          className={`flex-1 resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
            isInternalNote
              ? "border-amber-500/40 bg-amber-50 placeholder-amber-700/50 focus:border-amber-500 focus:ring-amber-500 dark:border-amber-500/30 dark:bg-amber-500/10 dark:placeholder-amber-300/40"
              : "border-slate-200 bg-white placeholder-slate-400 focus:border-brand-500 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          }`}
          maxLength={4000}
        />
        <ChatAttachButton
          mintToken={mintTokenForThread}
          onUploaded={(url) => {
            setAttachments((prev) => prev.length < MAX_ATTACHMENTS ? [...prev, url] : prev);
            setAttachmentError(null);
          }}
          onError={(msg) => setAttachmentError(msg)}
          disabled={disabled || sendMutation.isPending || attachments.length >= MAX_ATTACHMENTS}
        />
        <button
          type="button"
          onClick={submit}
          disabled={(!body.trim() && attachments.length === 0) || sendMutation.isPending || disabled}
          data-testid="message-composer-send"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white transition-colors hover:bg-brand-600 disabled:opacity-40"
          aria-label={t("messenger.composer.send", lang)}
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      {sendMutation.error && (
        <p className="px-3 pb-2 text-[10px] text-red-500">
          {sendMutation.error.message}
        </p>
      )}
      {relayError && (
        <p
          className="flex items-center gap-1 px-3 pb-2 text-[10px] text-amber-600 dark:text-amber-400"
          data-testid="relay-error"
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {t("messenger.composer.relaySaved", lang)} {describeRelayError(relayError, lang)}
        </p>
      )}
    </div>
  );
}
