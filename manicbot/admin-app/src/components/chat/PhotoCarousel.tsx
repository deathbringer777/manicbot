"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Swipeable photo carousel for catalog service photos in the web chat — mirrors
 * the desktop site's gallery (snap-scroll + dots, no deps). Broken image URLs
 * are dropped so a dead link never shows a torn-image icon. Rendered only when
 * the bot message carries more than one photo.
 */
export function PhotoCarousel({
  photos,
  brandColor = "#EC4899",
  onMediaLoad,
}: {
  photos: string[];
  brandColor?: string;
  /** Fired after each image settles so the chat can keep itself scrolled to bottom. */
  onMediaLoad?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [broken, setBroken] = useState<Set<number>>(new Set());
  // Desktop-only nav arrows: a mouse can't swipe the scroll-snap strip, so on
  // hover-capable pointers we reveal prev/next chevrons on hover. Touch devices
  // keep swipe and never see them. Detected via matchMedia (not a Tailwind hover
  // variant) so it can't silently fail to compile; SSR-safe (false until mount).
  const [hoverable, setHoverable] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      setHoverable(window.matchMedia("(hover: hover)").matches);
    }
  }, []);

  const valid = photos.map((url, i) => ({ url, i })).filter(({ i }) => !broken.has(i));

  const markBroken = useCallback(
    (i: number) => setBroken((prev) => new Set(prev).add(i)),
    [],
  );

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setActiveIdx(Math.round(el.scrollLeft / el.offsetWidth));
  };

  const scrollTo = (idx: number) => {
    const el = scrollRef.current;
    el?.scrollTo({ left: idx * (el.offsetWidth || 0), behavior: "smooth" });
  };

  if (!valid.length) return null;

  if (valid.length === 1) {
    const only = valid[0]!;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={only.url}
        alt=""
        className="mb-2 max-h-64 w-full rounded-lg object-cover"
        onLoad={onMediaLoad}
        onError={() => markBroken(only.i)}
      />
    );
  }

  return (
    <div className="mb-2">
      <div className="group relative">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex snap-x snap-mandatory gap-1.5 overflow-x-auto rounded-lg [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {valid.map(({ url, i }) => (
            <div key={i} className="w-full shrink-0 snap-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                loading="lazy"
                className="max-h-64 w-full rounded-lg object-cover"
                onLoad={onMediaLoad}
                onError={() => markBroken(i)}
              />
            </div>
          ))}
        </div>
        {/* Desktop hover arrows — hidden at the first/last edge. */}
        {hoverable && activeIdx > 0 && (
          <button
            type="button"
            aria-label="Предыдущее фото"
            onClick={() => scrollTo(activeIdx - 1)}
            className="absolute left-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-slate-900/40 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-slate-900/60 group-hover:opacity-100"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        {hoverable && activeIdx < valid.length - 1 && (
          <button
            type="button"
            aria-label="Следующее фото"
            onClick={() => scrollTo(activeIdx + 1)}
            className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-slate-900/40 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-slate-900/60 group-hover:opacity-100"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-1.5 flex justify-center gap-1.5">
        {valid.map((_, vi) => (
          <button
            key={vi}
            type="button"
            aria-label={`Фото ${vi + 1}`}
            onClick={() => scrollTo(vi)}
            className={`h-1.5 rounded-full transition-all ${
              vi === activeIdx ? "w-4" : "w-1.5 bg-slate-300 dark:bg-slate-600"
            }`}
            style={vi === activeIdx ? { background: brandColor } : undefined}
          />
        ))}
      </div>
    </div>
  );
}
