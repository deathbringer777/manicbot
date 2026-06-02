"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, WifiOff } from "lucide-react";
import { ChatHeader } from "~/components/chat/ChatHeader";
import { MessageBubble } from "~/components/chat/MessageBubble";
import { Composer } from "~/components/chat/Composer";
import { useVisualViewport } from "~/components/chat/useVisualViewport";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import type {
  ChatButton,
  ChatMessage,
  ChatMessageFromBot,
  ChatSalon,
} from "~/components/chat/chatTypes";

/**
 * ChatClient — the live web chat widget for a salon's public URL.
 *
 * Protocol:
 *  - On mount: POST /chat/init {slug} → {sessionId, chatId, salon}
 *    (sessionId is persisted in localStorage so reloads resume the chat)
 *  - Send: POST /chat/send {slug, sessionId, text | callbackData}
 *    → returns {messages: [...]} which are appended to the transcript
 *  - Poll: GET /chat/poll?slug=&sessionId=&since= → async/out-of-band pushes
 *    (reminders, cron-driven confirmations, etc.). Runs every 3s while the
 *    page is visible.
 *
 * Persistence:
 *  - Session id + full message history is stored in localStorage under the
 *    key `mb.chat.<slug>` so the conversation survives reloads. Cap at 200
 *    messages to avoid runaway growth.
 */

const STORAGE_PREFIX = "mb.chat.";
const HISTORY_CAP = 200;
const POLL_INTERVAL_MS = 3000;

/** Whitespace + all zero-width / BOM code points the Worker may emit. */
const BLANK_RE = /[\s\u200b-\u200f\u2060\ufeff]/g;

/**
 * True if a bot message is worth rendering. The Worker emits a zero-width-space
 * message with `remove_keyboard` to clear the Telegram reply keyboard; on web
 * that must NOT show up as an empty grey bubble. A message is renderable when it
 * has real text, OR a photo, OR at least one button — otherwise it's a no-op
 * layout artifact and we drop it. (User messages are always rendered.)
 */
export function isRenderableMessage(m: {
  role: "user" | "bot";
  text?: string | null;
  photo?: string | null;
  buttons?: ChatButton[][] | null;
}): boolean {
  if (m.role === "user") return true;
  const hasText = (m.text ?? "").replace(BLANK_RE, "").length > 0;
  const hasPhoto = !!m.photo;
  const hasButtons = Array.isArray(m.buttons) && m.buttons.some((row) => row.length > 0);
  return hasText || hasPhoto || hasButtons;
}

interface PersistedState {
  sessionId: string;
  chatId: number;
  lastTs: number;
  messages: ChatMessage[];
}

function loadPersisted(slug: string): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + slug);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed?.sessionId || typeof parsed.chatId !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function savePersisted(slug: string, state: PersistedState) {
  if (typeof window === "undefined") return;
  try {
    // Cap message history to avoid localStorage bloat
    const trimmed: PersistedState = {
      ...state,
      messages: state.messages.slice(-HISTORY_CAP),
    };
    localStorage.setItem(STORAGE_PREFIX + slug, JSON.stringify(trimmed));
  } catch {
    /* quota exceeded — ignore */
  }
}

export function ChatClient({
  slug,
  initialSalon,
}: {
  slug: string;
  initialSalon: ChatSalon;
}) {
  const { lang } = useLang();
  const langRef = useRef(lang);
  const lastSentLangRef = useRef<string | null>(null);
  const [salon, setSalon] = useState<ChatSalon>(initialSalon);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<"idle" | "initializing" | "sending" | "error" | "offline">("initializing");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const lastTsRef = useRef<number>(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Keep a ref so callbacks always read the latest lang without forcing
  // a re-bind of every event handler.
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  // Keep the message list pinned to the latest message. Scroll the list
  // container itself rather than scrollIntoView, which can shift the whole
  // page on iOS and make the surface "jump".
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = mainRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    scrollToBottom("auto");
  }, [messages.length, scrollToBottom]);

  // Follow the on-screen keyboard: size the surface to the visual viewport and
  // re-pin to the bottom as it animates, so the composer never floats / hides.
  useVisualViewport(rootRef, scrollToBottom);

  // ── Session bootstrap ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const persisted = loadPersisted(slug);
      if (persisted) {
        setSessionId(persisted.sessionId);
        setMessages(persisted.messages);
        lastTsRef.current = persisted.lastTs;
        setStatus("idle");
        return;
      }
      setStatus("initializing");
      try {
        const res = await fetch("/chat/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug }),
        });
        const data = (await res.json()) as
          | { ok: true; sessionId: string; chatId: number; salon: ChatSalon }
          | { ok: false; error: string };
        if (!res.ok || !("ok" in data) || !data.ok) {
          throw new Error("error" in data ? data.error : `HTTP ${res.status}`);
        }
        if (cancelled) return;
        setSessionId(data.sessionId);
        setSalon(data.salon);
        // Auto-greet: fire /start to the bot but do NOT render it as a user
        // bubble — a public web visitor never typed a slash command, so showing
        // "/start" in the transcript is confusing. The bot's welcome + menu
        // arrive as the first visible messages. The loading spinner covers the
        // brief gap until they land.
        await sendRaw({ text: "/start" }, data.sessionId);
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(e instanceof Error ? e.message : t("chat.connectionFailed", langRef.current));
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // ── Polling for out-of-band messages ─────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;

    async function poll() {
      while (!stopped) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (stopped || document.hidden) continue;
        try {
          const url = `/chat/poll?slug=${encodeURIComponent(slug)}&sessionId=${encodeURIComponent(sessionId!)}&since=${lastTsRef.current}`;
          const res = await fetch(url);
          if (!res.ok) continue;
          const data = (await res.json()) as
            | { ok: true; messages: Omit<ChatMessageFromBot, "role">[] }
            | { ok: false; error: string };
          if ("ok" in data && data.ok && data.messages.length > 0) {
            appendBotMessages(data.messages);
          }
        } catch {
          /* transient network glitch — keep polling */
        }
      }
    }

    void poll();
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, slug]);

  // ── Persist on every change ──────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    savePersisted(slug, {
      sessionId,
      chatId: 0, // derived from sessionId on server; not needed client-side
      lastTs: lastTsRef.current,
      messages,
    });
  }, [messages, sessionId, slug]);

  function appendBotMessages(incoming: Omit<ChatMessageFromBot, "role">[]) {
    const botMessages: ChatMessageFromBot[] = incoming
      .map((m) => ({
        role: "bot" as const,
        id: m.id,
        ts: m.ts,
        text: m.text,
        parseMode: m.parseMode,
        buttons: m.buttons,
        photo: m.photo,
        photos: m.photos,
        editMessageId: m.editMessageId,
      }))
      // Drop empty/zero-width "keyboard-clear" artifacts — but keep edits, which
      // may blank text while morphing an existing photo/buttons bubble in place.
      .filter((m) => isRenderableMessage(m) || !!m.editMessageId);
    for (const m of botMessages) {
      if (m.ts > lastTsRef.current) lastTsRef.current = m.ts;
    }
    setMessages((prev) => {
      // Dedup by id (in case /chat/send and /chat/poll race)
      const seen = new Set(prev.map((x) => x.id));
      const merged = [...prev];
      for (const m of botMessages) {
        if (m.editMessageId) {
          // Replace the earlier message matching editMessageId
          const idx = merged.findIndex((x) => x.id === m.editMessageId);
          if (idx >= 0) {
            merged[idx] = m;
            continue;
          }
        }
        if (!seen.has(m.id)) merged.push(m);
      }
      return merged;
    });
  }

  const sendRaw = useCallback(
    async (
      payload: { text?: string; callbackData?: string; messageId?: string },
      sid: string,
      optimisticList?: ChatMessage[],
    ) => {
      setStatus("sending");
      setErrorMsg(null);
      try {
        const userLang = langRef.current;
        const res = await fetch("/chat/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, sessionId: sid, userLang, ...payload }),
        });
        lastSentLangRef.current = userLang;
        const data = (await res.json()) as
          | { ok: true; messages: Omit<ChatMessageFromBot, "role">[] }
          | { ok: false; error: string };
        if (!res.ok || !("ok" in data) || !data.ok) {
          throw new Error("error" in data ? data.error : `HTTP ${res.status}`);
        }
        if (data.messages.length > 0) {
          appendBotMessages(data.messages);
        }
        setStatus("idle");
        return true;
      } catch (e) {
        // Revert optimistic message on failure
        if (optimisticList) setMessages((prev) => prev.filter((m) => !optimisticList.includes(m)));
        setStatus("error");
        setErrorMsg(e instanceof Error ? e.message : t("chat.sendFailed", langRef.current));
        return false;
      }
    },
    [slug],
  );

  // When the user flips the language dropdown mid-conversation, fire a
  // silent /start so the bot's main menu re-renders in the new language.
  // Past messages stay in their original language (they're frozen in
  // localStorage), but the next bot reply onwards is in the new lang.
  useEffect(() => {
    if (!sessionId) return;
    if (lastSentLangRef.current == null) return; // first render — handled by init
    if (lastSentLangRef.current === lang) return;
    lastSentLangRef.current = lang;
    void sendRaw({ text: "/start" }, sessionId);
  }, [lang, sessionId, sendRaw]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!sessionId) return;
      const optimistic: ChatMessage = {
        role: "user",
        id: `local-${Date.now()}`,
        ts: Math.floor(Date.now() / 1000),
        text,
      };
      setMessages((prev) => [...prev, optimistic]);
      await sendRaw({ text }, sessionId, [optimistic]);
    },
    [sessionId, sendRaw],
  );

  const handleButtonClick = useCallback(
    async (callbackData: string, messageId: string) => {
      if (!sessionId) return;
      // messageId carries the parent bubble id so the bot's editPhoto can
      // morph the existing photo bubble in place (catalog navigation arrows).
      await sendRaw({ callbackData, messageId }, sessionId);
    },
    [sessionId, sendRaw],
  );

  const brandColor = salon.brandPalette?.primary ?? "#EC4899";

  return (
    <div className="h-dvh overflow-hidden bg-slate-100 dark:bg-slate-950 md:flex md:items-stretch md:justify-center">
    <div
      ref={rootRef}
      className="fixed inset-x-0 top-0 flex h-dvh w-full flex-col md:static md:max-w-2xl lg:max-w-3xl md:shadow-2xl md:border-x md:border-slate-200/60 dark:md:border-white/5 bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900"
      style={{
        ['--chat-brand' as string]: brandColor,
      }}
    >
      <ChatHeader salon={salon} />

      {status === "error" && errorMsg && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-[11px] text-red-600 dark:text-red-400 flex items-center gap-2">
          <WifiOff className="h-3 w-3" />
          {errorMsg}
        </div>
      )}

      <main ref={mainRef} className="flex-1 overflow-y-auto overscroll-contain px-3 md:px-6 py-4 space-y-2.5">
        {status === "initializing" && messages.length === 0 && (
          <div className="flex items-center justify-center py-12 text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            salon={salon}
            onButtonClick={handleButtonClick}
          />
        ))}
        {status === "sending" && (
          <div className="flex justify-start pl-8">
            <div className="rounded-full bg-white/60 dark:bg-slate-800/60 px-3 py-1.5 text-[11px] text-slate-500 flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "120ms" }} />
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "240ms" }} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      <Composer
        onSend={handleSend}
        onFocus={() => scrollToBottom("auto")}
        disabled={!sessionId || status === "initializing"}
        brandColor={brandColor}
      />
    </div>
    </div>
  );
}
