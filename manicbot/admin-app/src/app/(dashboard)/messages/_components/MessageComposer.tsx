"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Send, StickyNote } from "lucide-react";
import { api } from "~/trpc/react";

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
  const taRef = useRef<HTMLTextAreaElement>(null);
  const utils = api.useUtils();

  const sendMutation = api.messenger.sendMessage.useMutation({
    onSuccess: async () => {
      setBody("");
      // Refresh thread + inbox
      await Promise.all([
        utils.messenger.getThread.invalidate({ tenantId, threadId }),
        utils.messenger.listThreads.invalidate({ tenantId }),
      ]);
      onSent?.();
      taRef.current?.focus();
    },
  });

  function submit() {
    const trimmed = body.trim();
    if (!trimmed || sendMutation.isPending || disabled) return;
    sendMutation.mutate({
      tenantId,
      threadId,
      body: trimmed,
      isInternalNote: threadKind === "client_conv" ? isInternalNote : false,
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const isClientConv = threadKind === "client_conv";
  const isSystem = threadKind === "system";

  if (isSystem) {
    return (
      <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 px-3 py-2 text-center text-[11px] text-slate-500">
        Системные сообщения — только для чтения
      </div>
    );
  }

  return (
    <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
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
            {isInternalNote ? "Внутренняя заметка" : "Обычное сообщение"}
          </button>
          {isInternalNote && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400">
              Клиент не увидит
            </span>
          )}
        </div>
      )}

      <div className="flex items-end gap-2 p-2">
        <textarea
          ref={taRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={
            isInternalNote
              ? "Заметка только для команды…"
              : isClientConv
                ? "Ответить клиенту…"
                : "Написать сообщение…"
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
        <button
          type="button"
          onClick={submit}
          disabled={!body.trim() || sendMutation.isPending || disabled}
          data-testid="message-composer-send"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white transition-colors hover:bg-brand-600 disabled:opacity-40"
          aria-label="Отправить"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      {sendMutation.error && (
        <p className="px-3 pb-2 text-[10px] text-red-500">
          {sendMutation.error.message}
        </p>
      )}
    </div>
  );
}
