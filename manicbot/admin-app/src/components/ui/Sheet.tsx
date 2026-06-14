"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Optional title — renders a sticky header with a close button. */
  title?: ReactNode;
  /** Sticky footer (action buttons). Gets iOS safe-area bottom padding. */
  footer?: ReactNode;
  /** Desktop max width (mobile is always a full-bleed bottom sheet). */
  maxWidthClass?: string;
  /** Override the scrollable body padding. */
  bodyClassName?: string;
  /** Extra classes on the backdrop (e.g. a higher z-index). */
  className?: string;
  /** id of the element labelling the dialog, when no `title` is passed. */
  labelledBy?: string;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Shared overlay primitive — a full-width bottom-sheet on phones, a centered
 * card on desktop (>=sm). Centralises the things every dialog needs and the
 * scattered one-off modals kept dropping: Escape-to-close, click-outside,
 * `<body>` scroll-lock, focus trap + restore, and an iOS safe-area-padded
 * footer (`max(…, env(safe-area-inset-bottom))`). Portalled to `<body>`.
 *
 * Migrate ad-hoc `fixed inset-0` modals onto this so width/height/scroll/a11y
 * behave identically everywhere instead of per-modal.
 */
export function Sheet({
  open,
  onClose,
  children,
  title,
  footer,
  maxWidthClass = "sm:max-w-md",
  bodyClassName = "px-4 py-4",
  className = "",
  labelledBy,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Escape-to-close + Tab focus-trap, with focus moved in on open and restored
  // to the previously-focused element on close.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const firstField = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (firstField ?? panel)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const nodes = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null);
      const firstEl = nodes[0];
      const lastEl = nodes[nodes.length - 1];
      if (!firstEl || !lastEl) return;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  // Lock background scroll while open so the page behind doesn't move.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-md sm:items-center sm:p-4 ${className}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl outline-none dark:border-white/10 dark:bg-slate-900 sm:rounded-2xl ${maxWidthClass}`}
      >
        {title != null && (
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-white/5">
            <div className="min-w-0 truncate text-[15px] font-bold text-slate-900 dark:text-white">
              {title}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="close"
              className="-mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.05]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${bodyClassName}`}>
          {children}
        </div>

        {footer != null && (
          <div className="flex gap-2 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-white/5 dark:bg-slate-900/95">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
