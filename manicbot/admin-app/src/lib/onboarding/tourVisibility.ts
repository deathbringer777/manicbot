function isElementVisible(el: HTMLElement): boolean {
  const st = getComputedStyle(el);
  if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** First matching visible node (several elements may share the same data-tour across breakpoints). */
export function firstVisibleTourElement(selector: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  for (const n of document.querySelectorAll(selector)) {
    if (n instanceof HTMLElement && isElementVisible(n)) return n;
  }
  return null;
}

/** Whether at least one matching node is visible. */
export function isTourElementVisible(selector: string): boolean {
  return firstVisibleTourElement(selector) !== null;
}
