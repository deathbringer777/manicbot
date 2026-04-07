"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, WifiOff } from "lucide-react";
import { ChatHeader } from "~/components/chat/ChatHeader";
import { MessageBubble } from "~/components/chat/MessageBubble";
import { Composer } from "~/components/chat/Composer";
import type {
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
  const [salon, setSalon] = useState<ChatSalon>(initialSalon);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<"idle" | "initializing" | "sending" | "error" | "offline">("initializing");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const lastTsRef = useRef<number>(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to newest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

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
        // Seed with a welcome prompt so the user sees /start immediately
        const welcome: ChatMessage = {
          role: "user",
          id: "seed-start",
          ts: Math.floor(Date.now() / 1000),
          text: "/start",
        };
        setMessages([welcome]);
        await sendRaw({ text: "/start" }, data.sessionId, [welcome]);
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(e instanceof Error ? e.message : "Connection failed");
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
    const botMessages: ChatMessageFromBot[] = incoming.map((m) => ({
      role: "bot",
      id: m.id,
      ts: m.ts,
      text: m.text,
      parseMode: m.parseMode,
      buttons: m.buttons,
      photo: m.photo,
      editMessageId: m.editMessageId,
    }));
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
      payload: { text?: string; callbackData?: string },
      sid: string,
      optimisticList?: ChatMessage[],
    ) => {
      setStatus("sending");
      setErrorMsg(null);
      try {
        const res = await fetch("/chat/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, sessionId: sid, ...payload }),
        });
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
        setErrorMsg(e instanceof Error ? e.message : "Send failed");
        return false;
      }
    },
    [slug],
  );

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
    async (callbackData: string) => {
      if (!sessionId) return;
      await sendRaw({ callbackData }, sessionId);
    },
    [sessionId, sendRaw],
  );

  const brandColor = salon.brandPalette?.primary ?? "#EC4899";

  return (
    <div
      className="h-dvh min-h-screen flex flex-col bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900"
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

      <main className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
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
        disabled={!sessionId || status === "initializing"}
        brandColor={brandColor}
      />
    </div>
  );
}
