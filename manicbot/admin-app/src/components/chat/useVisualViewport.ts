"use client";

import { useEffect, type RefObject } from "react";

/**
 * Pins a full-screen element to the *visual* viewport so the chat composer
 * stays glued just above the on-screen keyboard instead of being hidden behind
 * it — and stops the whole surface from "floating" up and down on iOS Safari.
 *
 * Why: iOS Safari keeps `100vh` / `100dvh` (and the layout viewport) at full
 * height when the keyboard opens; only `window.visualViewport` shrinks and may
 * scroll. We therefore size the element to `visualViewport.height` and translate
 * it by `visualViewport.offsetTop`, following the keyboard every frame. When the
 * keyboard closes the element stretches back to full height.
 *
 * Pair it with a `position: fixed; inset-x-0; top-0` element on mobile. No-op
 * where `visualViewport` is unavailable (older browsers, SSR), so the static
 * `h-dvh` fallback keeps working.
 *
 * @param ref       the element to size/translate
 * @param onChange  optional callback fired on every viewport change (e.g. to
 *                  re-scroll the message list to the bottom as the keyboard
 *                  animates in/out)
 */
export function useVisualViewport<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onChange?: () => void,
) {
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const el = ref.current;
    if (!vv || !el) return;

    let raf = 0;
    const apply = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.height = `${vv.height}px`;
        // Follow the visual viewport when Safari scrolls the layout viewport to
        // reveal the focused input — keeps the surface aligned, no jump.
        el.style.transform = vv.offsetTop ? `translateY(${vv.offsetTop}px)` : "";
        onChange?.();
      });
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      el.style.height = "";
      el.style.transform = "";
    };
  }, [ref, onChange]);
}
