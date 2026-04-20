"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Send, Loader2 } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

export function Composer({
  onSend,
  disabled,
  brandColor = "#EC4899",
  placeholder,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  brandColor?: string;
  placeholder?: string;
}) {
  const { lang } = useLang();
  const ph = placeholder ?? t("chat.inputPlaceholder", lang);
  const sendLabel = t("chat.send", lang);
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <form
      onSubmit={submit}
      className="flex items-end gap-2 px-3 md:px-4 py-2.5 border-t border-slate-200/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md"
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={ph}
        disabled={disabled}
        rows={1}
        className="flex-1 resize-none rounded-2xl bg-white dark:bg-slate-800 px-4 py-3 text-sm md:text-base text-slate-900 dark:text-white placeholder:text-slate-400 border border-slate-200 dark:border-white/10 focus:outline-none focus:ring-2 focus:ring-offset-0 disabled:opacity-50"
        style={{
          ['--tw-ring-color' as string]: brandColor,
        }}
      />
      <button
        type="submit"
        disabled={!canSend}
        className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center text-white disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-95"
        style={{ background: brandColor }}
        aria-label={sendLabel}
      >
        {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </button>
    </form>
  );
}
