import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLanguage } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";

import brandMark from "@/assets/manicbot-emoji-mark-ui.png";

/** Animated iPhone frame with Telegram-style chat (demo loop). */
export function TelegramPhoneDemo() {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const p = t.phoneDemo;
  const rootRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => setInView(!!e?.isIntersecting),
      { threshold: 0.25 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) {
      setStep(0);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const go = (s: number, ms: number) =>
      timers.push(setTimeout(() => setStep(s), ms));

    go(1, 500);
    go(2, 2200);
    go(3, 4200);
    go(4, 5200);
    go(5, 6200);
    timers.push(
      setTimeout(() => {
        setStep(0);
        setCycle((c) => c + 1);
      }, 11500)
    );

    return () => timers.forEach(clearTimeout);
  }, [inView, cycle]);

  const tg = {
    bg: "#0e1621",
    bubbleIn: "#182533",
    bubbleOut: "#2b5278",
    keyboard: "#17212b",
    keyBtn: "#213246",
    text: "#e4ecf2",
    textMuted: "#8b9bab",
    accent: "#5288c1",
  };

  return (
    <div
      ref={rootRef}
      className="relative mx-auto w-[min(100%,280px)] animate-phone-float"
      style={{ perspective: "1200px" }}
    >
      {/* Outer phone body */}
      <div
        className="relative rounded-[2.75rem] p-[10px] shadow-2xl"
        style={
          theme === "light"
            ? {
                background: "linear-gradient(145deg,#e8e8ed,#c8cad4)",
                boxShadow:
                  "0 40px 80px -24px rgba(15,23,42,0.25), 0 0 0 1px rgba(255,255,255,0.9), inset 0 2px 0 rgba(255,255,255,0.75)",
              }
            : {
                background: "linear-gradient(145deg,#1a1a22,#0a0a10)",
                boxShadow:
                  "0 50px 100px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.08)",
              }
        }
      >
        {/* Side buttons (decorative) */}
        <div
          className={[
            "absolute -left-[2px] top-[18%] h-8 w-[3px] rounded-l-sm",
            theme === "light" ? "bg-slate-400/90" : "bg-zinc-700/80",
          ].join(" ")}
          aria-hidden
        />
        <div
          className={[
            "absolute -left-[2px] top-[28%] h-14 w-[3px] rounded-l-sm",
            theme === "light" ? "bg-slate-400/90" : "bg-zinc-700/80",
          ].join(" ")}
          aria-hidden
        />
        <div
          className={[
            "absolute -right-[2px] top-[22%] h-16 w-[3px] rounded-r-sm",
            theme === "light" ? "bg-slate-400/90" : "bg-zinc-700/80",
          ].join(" ")}
          aria-hidden
        />

        {/* Screen bezel */}
        <div
          className="relative overflow-hidden rounded-[2.35rem]"
          style={{
            background: tg.bg,
            boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.4)",
          }}
        >
          {/* Dynamic Island */}
          <div className="flex justify-center pt-3 pb-1 z-20 relative">
            <div
              className="h-[28px] w-[100px] rounded-full flex items-center justify-end pr-2 gap-1"
              style={{ background: "#000" }}
            >
              <span className="w-2 h-2 rounded-full bg-zinc-800 ring-1 ring-zinc-700" />
            </div>
          </div>

          {/* Status bar */}
          <div
            className="flex items-center justify-between px-5 pb-1 text-[11px] font-medium"
            style={{ color: tg.text }}
          >
            <span>{p.time}</span>
            <div className="flex items-center gap-1 opacity-90">
              <span className="text-[10px]">5G</span>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 18h2v2H3v-2zm4-4h2v6H7v-6zm4-4h2v10h-2V10zm4-6h2v16h-2V4z" />
              </svg>
            </div>
          </div>

          {/* Telegram header */}
          <div
            className="flex items-center gap-2.5 px-3 py-2 border-b"
            style={{ borderColor: "rgba(255,255,255,0.06)", background: tg.bg }}
          >
            <button
              type="button"
              className="text-lg leading-none opacity-70"
              style={{ color: tg.accent }}
              aria-hidden
            >
              ‹
            </button>
            <div className="relative h-9 w-9 flex-shrink-0 overflow-hidden rounded-full ring-1 ring-white/25">
              <img
                src={brandMark}
                alt=""
                width={36}
                height={36}
                className="h-full w-full object-cover"
                decoding="async"
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold truncate" style={{ color: tg.text }}>
                Manicbot
              </div>
              <div className="text-[11px]" style={{ color: tg.textMuted }}>
                {p.botLabel}
              </div>
            </div>
          </div>

          {/* Chat area */}
          <div
            className="relative h-[420px] overflow-hidden flex flex-col"
            style={{ background: tg.bg }}
          >
            <div className="flex-1 overflow-y-auto px-2.5 pt-3 pb-2 space-y-2 scrollbar-none">
              {/* Welcome bubble */}
              {step >= 1 && (
                <div
                  key={`w-${cycle}`}
                  className="max-w-[94%] rounded-xl rounded-tl-sm px-3 py-2.5 text-[12px] leading-snug animate-chat-bubble-in shadow-sm"
                  style={{
                    background: tg.bubbleIn,
                    color: tg.text,
                    boxShadow: "0 1px 0 rgba(0,0,0,0.2)",
                  }}
                >
                  <p className="font-medium mb-1">{p.welcomeLead}</p>
                  <p className="mb-2 opacity-95">{p.welcomeHi}</p>
                  <p className="mb-2 opacity-90">{p.welcomeBody}</p>
                  <p className="text-[11px] mb-1.5 font-medium" style={{ color: tg.textMuted }}>
                    {p.featuresIntro}
                  </p>
                  <ul className="text-[11px] space-y-0.5 mb-2 opacity-90 list-disc pl-3.5">
                    {p.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <p className="text-[11px] opacity-80">{p.choosePrompt}</p>
                </div>
              )}

              {/* Inline keyboard (simplified) */}
              {step >= 2 && (
                <div
                  key={`k-${cycle}`}
                  className="space-y-1.5 pt-1 animate-chat-keyboard-in"
                  style={{ opacity: 0, animationFillMode: "forwards" }}
                >
                  <KeyboardRow>
                    <KeyBtn full>{p.menuBook}</KeyBtn>
                  </KeyboardRow>
                  <KeyboardRow>
                    <KeyBtn>{p.menuCatalog}</KeyBtn>
                    <KeyBtn>{p.menuPrice}</KeyBtn>
                  </KeyboardRow>
                  <KeyboardRow>
                    <KeyBtn full>{p.menuMy}</KeyBtn>
                  </KeyboardRow>
                </div>
              )}

              {/* Typing */}
              {step === 3 && (
                <div
                  className="flex justify-end pt-1"
                  key={`ty-${cycle}`}
                >
                  <div
                    className="rounded-2xl rounded-br-sm px-3 py-2 flex gap-1"
                    style={{ background: tg.bubbleOut }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-white/50"
                      style={{ animation: "typing-dot 1s ease-in-out infinite", animationDelay: "0ms" }}
                    />
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-white/50"
                      style={{ animation: "typing-dot 1s ease-in-out infinite", animationDelay: "0.15s" }}
                    />
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-white/50"
                      style={{ animation: "typing-dot 1s ease-in-out infinite", animationDelay: "0.3s" }}
                    />
                  </div>
                </div>
              )}

              {/* User message */}
              {step >= 4 && (
                <div className="flex justify-end pt-1" key={`u-${cycle}`}>
                  <div
                    className="max-w-[88%] rounded-xl rounded-br-sm px-3 py-2 text-[12px] leading-snug animate-chat-bubble-in"
                    style={{ background: tg.bubbleOut, color: "#fff" }}
                  >
                    {p.userMessage}
                  </div>
                </div>
              )}

              {/* Confirmation */}
              {step >= 5 && (
                <div
                  key={`c-${cycle}`}
                  className="max-w-[94%] rounded-xl rounded-tl-sm px-3 py-2.5 text-[12px] leading-snug animate-chat-bubble-in space-y-1.5"
                  style={{ background: tg.bubbleIn, color: tg.text }}
                >
                  <p className="font-semibold">{p.confirmTitle}</p>
                  <p>{p.confirmService}</p>
                  <p>{p.confirmWhen}</p>
                  <p>{p.confirmDuration}</p>
                  <p>{p.confirmPrice}</p>
                  <p>{p.confirmClient}</p>
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      className="flex-1 py-1.5 rounded-md text-[11px] font-medium"
                      style={{ background: tg.keyBtn, color: "#86efac" }}
                    >
                      {p.btnOk}
                    </button>
                    <button
                      type="button"
                      className="flex-1 py-1.5 rounded-md text-[11px] font-medium"
                      style={{ background: tg.keyBtn, color: "#fca5a5" }}
                    >
                      {p.btnNo}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Input bar (static) */}
            <div
              className="px-2 py-2 flex items-center gap-2 border-t"
              style={{ borderColor: "rgba(255,255,255,0.06)", background: tg.keyboard }}
            >
              <div
                className="flex-1 h-8 rounded-full text-[11px] flex items-center px-3"
                style={{ background: "rgba(0,0,0,0.25)", color: tg.textMuted }}
              >
                {p.inputPlaceholder}
              </div>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm"
                style={{ background: tg.accent, color: "#fff" }}
              >
                ➤
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Reflection / glow under phone */}
      <div
        className="pointer-events-none absolute -bottom-8 left-1/2 h-10 w-[70%] -translate-x-1/2 rounded-[100%] opacity-25 blur-2xl"
        style={{ background: "linear-gradient(90deg,#7c3aed,#06b6d4)" }}
        aria-hidden
      />
    </div>
  );
}

function KeyboardRow({ children }: { children: ReactNode }) {
  return <div className="flex gap-1.5">{children}</div>;
}

function KeyBtn({ children, full }: { children: ReactNode; full?: boolean }) {
  return (
    <button
      type="button"
      className={`text-[11px] font-medium py-2 px-2 rounded-md leading-tight text-center ${
        full ? "flex-1" : "flex-1"
      }`}
      style={{
        background: "#213246",
        color: "#dbeafe",
        border: "1px solid rgba(255,255,255,0.05)",
        boxShadow: "0 1px 0 rgba(0,0,0,0.25)",
      }}
    >
      {children}
    </button>
  );
}
