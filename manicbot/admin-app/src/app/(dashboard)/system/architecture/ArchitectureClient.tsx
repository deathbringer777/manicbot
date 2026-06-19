"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as RMouseEvent, WheelEvent as RWheelEvent } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import {
  Network, RefreshCw, ZoomIn, ZoomOut, Maximize2, AlertTriangle, Loader2, ShieldCheck,
} from "lucide-react";

const ICONBTN =
  "inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 " +
  "dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 " +
  "dark:hover:bg-white/5 transition";

// Monotonic id so each mermaid.render() call gets a fresh element id.
let renderSeq = 0;

/**
 * God-Mode ERD viewer. Pulls the auto-generated Mermaid diagram from the
 * `system.getArchitectureDiagram` procedure (admin-only) and renders it
 * client-side with wheel-zoom + drag-pan. `mermaid` is loaded lazily so it
 * only ships on this route.
 */
export default function ArchitectureClient() {
  const { data, isLoading, error, refetch, isFetching } =
    api.system.getArchitectureDiagram.useQuery(undefined, { staleTime: 5 * 60_000 });

  const hostRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [renderError, setRenderError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    const mermaidText = data?.mermaid;
    if (!mermaidText || !hostRef.current) return;
    let cancelled = false;
    setRenderError(null);
    setRendering(true);
    void (async () => {
      try {
        // @ts-ignore — `mermaid` is a real dependency (package.json); it is only
        // absent from the symlinked worktree node_modules used for local checks.
        const mermaid = (await import("mermaid")).default;
        const isDark =
          typeof document !== "undefined" &&
          document.documentElement.classList.contains("dark");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          maxTextSize: 200_000,
          theme: isDark ? "dark" : "default",
        });
        const { svg } = await mermaid.render(`erd-${++renderSeq}`, mermaidText);
        if (!cancelled && hostRef.current) hostRef.current.innerHTML = svg;
      } catch (e) {
        if (!cancelled) setRenderError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data?.mermaid]);

  const onWheel = useCallback((e: RWheelEvent) => {
    setZoom((z) => Math.min(4, Math.max(0.15, z * (e.deltaY < 0 ? 1.12 : 0.89))));
  }, []);
  const onMouseDown = (e: RMouseEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onMouseMove = (e: RMouseEvent) => {
    if (!drag.current) return;
    setPan({
      x: drag.current.px + (e.clientX - drag.current.x),
      y: drag.current.py + (e.clientY - drag.current.y),
    });
  };
  const endDrag = () => {
    drag.current = null;
  };
  const reset = () => {
    setZoom(1);
    setPan({ x: 40, y: 40 });
  };

  const generatedLabel =
    data?.source === "generated" && data?.generatedAt
      ? new Date(data.generatedAt).toLocaleString("ru-RU")
      : null;

  return (
    <Shell>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-sky-400" />
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
              Архитектура — ERD базы данных
            </h1>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setZoom((z) => Math.min(4, z * 1.2))} className={ICONBTN} title="Приблизить">
              <ZoomIn className="w-4 h-4" />
            </button>
            <button onClick={() => setZoom((z) => Math.max(0.15, z * 0.83))} className={ICONBTN} title="Отдалить">
              <ZoomOut className="w-4 h-4" />
            </button>
            <button onClick={reset} className={ICONBTN} title="Сбросить вид">
              <Maximize2 className="w-4 h-4" />
            </button>
            <button onClick={() => void refetch()} className={ICONBTN} title="Обновить">
              <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Приватно — только God Mode
          </span>
          {typeof data?.tableCount === "number" && data.tableCount > 0 && (
            <span>Таблиц: {data.tableCount}</span>
          )}
          {generatedLabel ? (
            <span>Обновлено на деплое: {generatedLabel}</span>
          ) : data?.source === "stub" ? (
            <span className="text-amber-500">
              Заглушка — реальная схема появится после следующего деплоя admin-app
            </span>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/5 p-6 text-sm text-red-600 dark:text-red-400">
            Нет доступа или ошибка загрузки диаграммы.
          </div>
        ) : isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Загрузка…
          </div>
        ) : (
          <div
            className="relative overflow-hidden rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 h-[72vh] cursor-grab active:cursor-grabbing select-none"
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
          >
            {(rendering || isFetching) && (
              <div className="absolute top-2 left-2 z-10 inline-flex items-center gap-1 text-xs text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Рендер…
              </div>
            )}
            {renderError && (
              <div className="absolute inset-0 z-10 grid place-items-center p-6 text-center text-sm text-red-500">
                <div>
                  <AlertTriangle className="w-5 h-5 mx-auto mb-2" />
                  Не удалось отрисовать диаграмму:
                  <br />
                  <code className="text-xs break-all">{renderError}</code>
                </div>
              </div>
            )}
            <div
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "0 0",
              }}
              className="will-change-transform"
            >
              <div ref={hostRef} className="[&_svg]:max-w-none" />
            </div>
          </div>
        )}

        <p className="text-xs text-slate-400">
          Колёсико — масштаб, перетаскивание — панорама. Диаграмма пересобирается из{" "}
          <code>schema.sql</code> на каждом деплое admin-app и видна только тебе.
        </p>
      </div>
    </Shell>
  );
}
