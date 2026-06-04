"use client";

/**
 * useCoarsePointer — true on real touch devices (phone, and tablet/iPad in
 * any orientation), false on mouse/trackpad machines including touchscreen
 * laptops.
 *
 * Keys off input *modality* via `(hover: none) and (pointer: coarse)`, NOT
 * viewport width — so an iPad in landscape (~1024px) is correctly treated as
 * touch, and a narrow desktop window is not. This is the right axis for
 * disabling the Google-Calendar-style drag gestures (create / move / resize)
 * that otherwise hijack native scrolling on touch, while leaving desktop
 * (mouse/trackpad) behaviour completely unchanged.
 *
 * SSR-safe: returns `false` on the server and during the first client paint
 * (the desktop default → no hydration mismatch), then resolves in an effect
 * and stays in sync via the matchMedia `change` event.
 */

import { useEffect, useState } from "react";

export const TOUCH_POINTER_QUERY = "(hover: none) and (pointer: coarse)";

export function useCoarsePointer(): boolean {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(TOUCH_POINTER_QUERY);
    setIsTouch(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isTouch;
}
