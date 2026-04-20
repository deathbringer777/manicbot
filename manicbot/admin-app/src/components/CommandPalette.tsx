"use client";

/**
 * Command Palette (Cmd/Ctrl+K).
 *
 * Renders a full-screen overlay on mobile, centered modal on desktop.
 * Search queries the global server endpoint once the input has ≥2 chars.
 * Keyboard nav: ↑↓ select, Enter navigates, Esc closes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2, User, UserPlus, Mail, Search, X, ChevronRight,
  ArrowRight, CornerDownLeft, Loader2,
} from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

const ICONS = { tenant: Building2, user: User, lead: UserPlus, contact: Mail };

export function CommandPalette() {
  const { role } = useRole();
  const { lang } = useLang();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isOpenKey =
        (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      if (isOpenKey) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
    else setQ("");
  }, [open]);

  const enabled = open && role === "system_admin" && q.trim().length >= 2;
  const searchQ = api.search.global.useQuery(
    { q: q.trim(), limit: 20 },
    { enabled, staleTime: 10_000 },
  );
  const hits = useMemo(() => searchQ.data ?? [], [searchQ.data]);

  useEffect(() => setCursor(0), [hits]);

  // keyboard nav
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, hits.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === "Enter" && hits[cursor]) {
        e.preventDefault();
        const hit = hits[cursor]!;
        router.push(hit.href);
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, cursor, hits, router]);

  // Don't render anything for non-admin users
  if (role !== "system_admin") return null;
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      data-testid="command-palette"
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start sm:items-center justify-center p-0 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="relative w-full sm:max-w-2xl h-full sm:h-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 sm:rounded-2xl shadow-2xl flex flex-col">
        <div className="flex items-center gap-2 p-3 border-b border-slate-100 dark:border-white/10">
          <Search size={16} className="text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            data-testid="command-palette-input"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("plugins.search.placeholder", lang)}
            className="flex-1 bg-transparent border-0 outline-none text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
          />
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="p-1 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto" data-testid="command-palette-results">
          {q.trim().length < 2 ? (
            <div className="p-6 text-xs text-slate-400">⌘K / Ctrl+K</div>
          ) : searchQ.isLoading ? (
            <div className="p-6 flex items-center justify-center text-slate-400">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : hits.length === 0 ? (
            <div className="p-6 text-sm text-slate-400">
              {t("plugins.catalog.emptyResult", lang)}
            </div>
          ) : (
            <ul className="py-1">
              {hits.map((hit, i) => {
                const Icon = ICONS[hit.kind];
                const active = i === cursor;
                return (
                  <li key={`${hit.kind}:${hit.id}`}>
                    <button
                      type="button"
                      data-testid="command-palette-hit"
                      data-active={active ? "1" : "0"}
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => {
                        router.push(hit.href);
                        setOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                        active
                          ? "bg-brand-500/10 text-brand-700 dark:text-brand-300"
                          : "hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200"
                      }`}
                    >
                      <Icon size={14} className="text-slate-400 shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate">{hit.title}</span>
                        {hit.subtitle && (
                          <span className="block text-[11px] text-slate-500 truncate">{hit.subtitle}</span>
                        )}
                      </span>
                      <ChevronRight size={12} className="text-slate-300 dark:text-slate-600 shrink-0" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="hidden sm:flex items-center justify-between gap-4 px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100 dark:border-white/10">
          <span className="inline-flex items-center gap-1"><ArrowRight size={10} /> ↑↓</span>
          <span className="inline-flex items-center gap-1"><CornerDownLeft size={10} /> Enter</span>
          <span>Esc</span>
        </div>
      </div>
    </div>
  );
}
