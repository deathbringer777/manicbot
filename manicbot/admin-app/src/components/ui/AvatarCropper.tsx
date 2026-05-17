"use client";

/**
 * AvatarCropper — Telegram-style pan + zoom cropper for avatar photos.
 *
 * Replaces the silent centre-square auto-crop in {@link MasterAvatarPicker}
 * and {@link ClientAvatarPicker}. The operator picks a file, this overlay
 * opens, they pan the photo inside a circular viewport, zoom with the
 * slider (or scroll-wheel / pinch), then tap "Сохранить" to bake the
 * crop into a 1:1 512×512 WebP — which the parent picker uploads exactly
 * like before.
 *
 * Layout:
 *   * `fixed inset-0 z-[120]` — sits above the picker (z-[110]) and the
 *     parent detail modal (z-[100]).
 *   * Pan: pointer events (mouse / single-touch).
 *   * Zoom: wheel, slider, or two-finger pinch.
 *   * Min scale = 1 (image covers the circle on its shorter side).
 *     Max scale = 4. The slider granularity is 0.01.
 *
 * Output: a 512×512 WebP File produced via {@link renderCroppedFile}.
 * The math is fully covered by `avatarCrop.test.ts`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X, RotateCcw, Check } from "lucide-react";
import {
  clampOffset,
  maxOffsetRange,
  renderCroppedFile,
} from "~/lib/avatarCrop";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const SCALE_STEP = 0.01;

interface Props {
  file: File;
  /** Final output edge in image px. Default 512. */
  outputSize?: number;
  /** Cancel — closes without producing a file. */
  onCancel: () => void;
  /** Save — receives the cropped File. */
  onCropped: (cropped: File) => void;
}

export function AvatarCropper({ file, outputSize = 512, onCancel, onCropped }: Props) {
  const { lang } = useLang();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [viewportSize, setViewportSize] = useState(320);

  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  // ── lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => { URL.revokeObjectURL(url); };
  }, [file]);

  // Responsive viewport: ~min(360, viewportWidth - 64). Re-measured on
  // resize so phone rotation doesn't leave the circle off-screen.
  useEffect(() => {
    function pick() {
      if (typeof window === "undefined") return;
      const target = Math.min(360, window.innerWidth - 64, window.innerHeight - 240);
      setViewportSize(Math.max(220, Math.floor(target)));
    }
    pick();
    window.addEventListener("resize", pick);
    return () => window.removeEventListener("resize", pick);
  }, []);

  // ── derived constraints ────────────────────────────────────────────
  const range = useMemo(() => {
    if (!natural) return { x: 0, y: 0 };
    return maxOffsetRange({
      naturalWidth: natural.w,
      naturalHeight: natural.h,
      viewportSize,
      scale,
    });
  }, [natural, viewportSize, scale]);

  // Re-clamp whenever scale or viewport changes (zooming out can shrink
  // the range below the current offset → image would leak past the
  // circle edge).
  useEffect(() => {
    if (!natural) return;
    setOffset((prev) => {
      const c = clampOffset({
        naturalWidth: natural.w,
        naturalHeight: natural.h,
        viewportSize,
        scale,
        offsetX: prev.x,
        offsetY: prev.y,
      });
      return { x: c.offsetX, y: c.offsetY };
    });
  }, [scale, viewportSize, natural]);

  // ── input handlers ─────────────────────────────────────────────────
  function clampPair(x: number, y: number) {
    if (!natural) return { x, y };
    const c = clampOffset({
      naturalWidth: natural.w,
      naturalHeight: natural.h,
      viewportSize,
      scale,
      offsetX: x,
      offsetY: y,
    });
    return { x: c.offsetX, y: c.offsetY };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointersRef.current.size === 1) {
      // Single pointer → pan.
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseX: offset.x,
        baseY: offset.y,
      };
      pinchRef.current = null;
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } else if (activePointersRef.current.size === 2) {
      // Second pointer → pinch.
      const pts = Array.from(activePointersRef.current.values());
      const [a, b] = pts;
      if (a && b) {
        pinchRef.current = {
          startDist: Math.hypot(a.x - b.x, a.y - b.y),
          startScale: scale,
        };
        dragRef.current = null;
      }
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!natural) return;
    if (!activePointersRef.current.has(e.pointerId)) return;
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchRef.current && activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      const [a, b] = pts;
      if (a && b && pinchRef.current.startDist > 0) {
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const ratio = dist / pinchRef.current.startDist;
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchRef.current.startScale * ratio));
        setScale(next);
      }
      return;
    }

    if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const next = clampPair(dragRef.current.baseX + dx, dragRef.current.baseY + dy);
      setOffset(next);
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) pinchRef.current = null;
    if (activePointersRef.current.size === 0) dragRef.current = null;
  }

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    // deltaY < 0 means scrolling up → zoom in.
    const next = Math.max(
      MIN_SCALE,
      Math.min(MAX_SCALE, scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08)),
    );
    setScale(next);
  }

  function reset() {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }

  async function save() {
    if (!natural) return;
    setBusy(true);
    try {
      const cropped = await renderCroppedFile(
        file,
        {
          naturalWidth: natural.w,
          naturalHeight: natural.h,
          viewportSize,
          scale,
          offsetX: offset.x,
          offsetY: offset.y,
        },
        outputSize,
      );
      onCropped(cropped);
    } finally {
      setBusy(false);
    }
  }

  // ── render ─────────────────────────────────────────────────────────
  const imageDisplayedWidth = natural ? (natural.w / Math.min(natural.w, natural.h)) * viewportSize * scale : 0;
  const imageDisplayedHeight = natural ? (natural.h / Math.min(natural.w, natural.h)) * viewportSize * scale : 0;

  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col items-center justify-between bg-slate-950/95 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      data-testid="avatar-cropper-overlay"
    >
      {/* Top bar */}
      <div className="flex w-full max-w-md items-center justify-between text-slate-200">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-sm transition hover:bg-white/10 disabled:opacity-50"
          aria-label={t("common.cancel", lang)}
          data-testid="avatar-cropper-cancel"
        >
          <X className="h-4 w-4" />
          {t("common.cancel", lang)}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy || !natural}
          className="flex items-center gap-1.5 rounded-full bg-brand-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-60"
          data-testid="avatar-cropper-save"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {t("common.save", lang)}
        </button>
      </div>

      {/* Viewport */}
      <div className="flex flex-1 items-center justify-center">
        <div
          ref={viewportRef}
          className="relative select-none overflow-hidden"
          style={{ width: viewportSize, height: viewportSize, touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          data-testid="avatar-cropper-viewport"
        >
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                setNatural({ w: img.naturalWidth, h: img.naturalHeight });
              }}
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                width: imageDisplayedWidth || "auto",
                height: imageDisplayedHeight || "auto",
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                maxWidth: "none",
                maxHeight: "none",
                userSelect: "none",
                pointerEvents: "none",
              }}
              data-testid="avatar-cropper-image"
            />
          )}

          {/* Dark mask with a circular hole */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              boxShadow: "0 0 0 9999px rgba(2,6,23,0.78)",
              borderRadius: "50%",
            }}
          />

          {/* Corner brackets (camera-style guides) */}
          <CornerBrackets />
        </div>
      </div>

      {/* Bottom bar — zoom slider + reset */}
      <div className="flex w-full max-w-md flex-col gap-3">
        <input
          type="range"
          min={MIN_SCALE}
          max={MAX_SCALE}
          step={SCALE_STEP}
          value={scale}
          onChange={(e) => setScale(Number(e.target.value))}
          disabled={busy || !natural}
          className="w-full accent-brand-500"
          aria-label={t("avatar.crop.zoom", lang)}
          data-testid="avatar-cropper-zoom"
        />
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>{t("avatar.crop.hint", lang)}</span>
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-slate-300 transition hover:bg-white/10 disabled:opacity-50"
            data-testid="avatar-cropper-reset"
          >
            <RotateCcw className="h-3 w-3" />
            {t("avatar.crop.reset", lang)}
          </button>
        </div>
      </div>
    </div>
  );
}

function CornerBrackets() {
  // Four L-shaped corner marks at the square viewport bounds. Pure CSS,
  // no SVG — keeps the bundle thin and the rendering crisp at any size.
  const base =
    "pointer-events-none absolute h-5 w-5 border-white/85";
  return (
    <>
      <span aria-hidden className={`${base} left-1 top-1 border-l-2 border-t-2`} />
      <span aria-hidden className={`${base} right-1 top-1 border-r-2 border-t-2`} />
      <span aria-hidden className={`${base} bottom-1 left-1 border-b-2 border-l-2`} />
      <span aria-hidden className={`${base} bottom-1 right-1 border-b-2 border-r-2`} />
    </>
  );
}
