"use client";

/**
 * AnchoredPopover — a small Google-Calendar-style floating card anchored
 * next to a calendar block. Portals into <body> and positions itself with
 * `useAnchoredPosition` (auto-flip + viewport clamp).
 *
 * Dismissal mirrors StatusActionMenu: outside-click (mousedown), Escape,
 * and scroll all close it — but every dismissal path is gated by
 * `closeOnOutside`, which callers drop to `false` while a NESTED overlay
 * (e.g. a delete ConfirmDialog or the client-detail modal) is open. That
 * avoids the classic nested-portal bug where clicking a button inside a
 * higher-z dialog (which is NOT a DOM descendant of this panel) would
 * otherwise tear the whole popover — and the dialog — down mid-click.
 *
 * Mobile (<640px): the anchored card would point at a sliver-thin chip, so
 * we fall back to a centered card over a light scrim. The scrim is
 * deliberately light (slate-900/30, no blur) — the calendar must stay
 * visible behind it (the user's "фон не видно" complaint was about the old
 * full-screen `backdrop-blur` create modal).
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripHorizontal, RotateCcw } from "lucide-react";
import { useAnchoredPosition, type AnchorRect } from "~/lib/calendar/useAnchoredPosition";
import { useFloatingDialog } from "~/lib/calendar/useFloatingDialog";
import type { AppointmentDialogRect } from "~/lib/useDashboardPrefs";

interface Props {
  /** Captured rect of the anchor element (clicked block / drag-release point). */
  anchorRect: AnchorRect | null;
  onClose: () => void;
  children: React.ReactNode;
  /** Desktop panel width in px (also drives the horizontal clamp). */
  width?: number;
  /** Height estimate used only for the flip-above decision. */
  heightEstimate?: number;
  /**
   * When false, outside-click / Esc / scroll do NOT close the popover.
   * Callers set this off while a nested modal (ConfirmDialog, client card)
   * is open so a click inside that modal can't collapse this layer.
   */
  closeOnOutside?: boolean;
  className?: string;
  testId?: string;
  ariaLabel?: string;
  /**
   * Google-Calendar-style drag + resize (desktop only). When `boundsRef` is
   * supplied the popover gains a drag grip + corner resize handle and is
   * clamped to that element (the calendar work area). `floatingValue` is the
   * persisted rect (work-area coords); `onFloatingChange` fires on each
   * drag/resize commit; `onFloatingReset` clears it back to anchored.
   */
  boundsRef?: React.RefObject<HTMLElement | null>;
  floatingValue?: AppointmentDialogRect | null;
  onFloatingChange?: (rect: AppointmentDialogRect) => void;
  onFloatingReset?: () => void;
  /** Localized labels for the drag/reset affordances. */
  dragLabel?: string;
  resetLabel?: string;
}

export function AnchoredPopover({
  anchorRect,
  onClose,
  children,
  width = 360,
  heightEstimate = 340,
  closeOnOutside = true,
  className,
  testId,
  ariaLabel,
  boundsRef,
  floatingValue = null,
  onFloatingChange,
  onFloatingReset,
  dragLabel,
  resetLabel,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 639px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const pos = useAnchoredPosition(anchorRect, !isMobile, width, heightEstimate);

  // Drag/resize is opt-in (boundsRef supplied) and desktop-only. The hook
  // returns a `style` override when a floating rect is active (saved value or
  // a live gesture); otherwise the anchored positioning below is used.
  const dragEnabled = !!boundsRef && !isMobile;
  const floating = useFloatingDialog({
    enabled: dragEnabled,
    boundsRef: boundsRef ?? { current: null },
    panelRef,
    value: floatingValue,
    onCommit: (rect) => onFloatingChange?.(rect),
    anchoredLeft: pos?.left ?? -9999,
    anchoredTop: pos?.top ?? -9999,
    width,
  });

  useEffect(() => {
    if (!closeOnOutside) return;
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Close when the calendar scrolls underneath, but ignore scrolls that
    // originate INSIDE the panel (its own overflow-y-auto body), which the
    // capture-phase listener would otherwise also catch.
    const onScroll = (e: Event) => {
      const target = e.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [closeOnOutside, onClose]);

  if (typeof document === "undefined") return null;

  const surface =
    "rounded-2xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5 " +
    "dark:border-white/10 dark:bg-slate-900 dark:ring-white/5";

  const node = isMobile ? (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center"
      aria-label={ariaLabel}
    >
      {/* Light scrim — calendar stays visible behind it (no heavy blur). */}
      <div className="absolute inset-0 bg-slate-900/30" aria-hidden />
      <div
        ref={panelRef}
        data-testid={testId}
        className={`relative w-full max-w-sm ${surface} ${className ?? ""}`}
      >
        {children}
      </div>
    </div>
  ) : dragEnabled ? (
    // Draggable + resizable floating dialog (Google-Calendar style). Owns its
    // own scroll: a grip header + the scrollable body + a corner resize grip,
    // so the header never scrolls away when a fixed height is in effect.
    <div
      ref={panelRef}
      data-testid={testId}
      aria-label={ariaLabel}
      style={
        floating.style ?? {
          position: "fixed",
          left: pos?.left ?? -9999,
          top: pos?.top ?? -9999,
          width,
        }
      }
      className={`z-50 flex flex-col overflow-hidden ${surface}`}
    >
      <div
        {...floating.dragHandleProps}
        className="relative flex shrink-0 items-center justify-center border-b border-slate-200 py-1.5 text-slate-400 hover:text-slate-600 dark:border-white/10 dark:hover:text-white/70"
        title={dragLabel}
        aria-label={dragLabel}
        data-testid="popover-drag-handle"
      >
        <GripHorizontal className="h-4 w-4" />
        {floatingValue && onFloatingReset && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onFloatingReset}
            title={resetLabel}
            aria-label={resetLabel}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white"
            data-testid="popover-reset"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className={`min-h-0 flex-1 overflow-y-auto ${className ?? ""}`}>
        {children}
      </div>
      <div
        {...floating.resizeHandleProps}
        className="absolute bottom-0 right-0 flex h-4 w-4 items-end justify-end p-0.5 text-slate-400"
        data-testid="popover-resize-handle"
        aria-hidden
      >
        <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
          <path d="M9 1 L9 9 L1 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  ) : (
    <div
      ref={panelRef}
      data-testid={testId}
      aria-label={ariaLabel}
      style={{
        position: "fixed",
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width,
      }}
      className={`z-50 ${surface} ${className ?? ""}`}
    >
      {children}
    </div>
  );

  return createPortal(node, document.body);
}
