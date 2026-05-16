"use client";

import { useState, useRef, useEffect, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, CheckCircle2, XCircle, UserX, AlertTriangle } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";
import { STATUS_STYLES } from "~/lib/appointments";

type AptStatus = "pending" | "confirmed" | "cancelled" | "rejected" | "no_show" | "done";

interface MenuItem {
  key: string;
  label: string;
  icon: typeof CheckCircle2;
  tone: string;
  run: () => void;
}

export interface StatusActionMenuProps {
  /** Effective status key used for visual style — same one AptCard already computes. */
  statusKey: AptStatus;
  /** Label rendered inside the pill (already localized, may include cancelledBy/noShowBy hint). */
  label: string;
  lang: Lang;
  onAction?: (status: "confirmed" | "cancelled" | "rejected") => void;
  onNoShow?: (noShowBy: "client" | "master") => void;
}

export function StatusActionMenu({ statusKey, label, lang, onAction, onNoShow }: StatusActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = useId();

  const items: MenuItem[] = [];
  if (statusKey === "pending") {
    if (onAction) {
      items.push({
        key: "confirm",
        label: t("salon.agenda.confirm", lang),
        icon: CheckCircle2,
        tone: "text-emerald-500 hover:bg-emerald-500/10",
        run: () => onAction("confirmed"),
      });
      items.push({
        key: "reject",
        label: t("salon.agenda.reject", lang),
        icon: XCircle,
        tone: "text-red-500 hover:bg-red-500/10",
        run: () => onAction("rejected"),
      });
    }
  } else if (statusKey === "confirmed") {
    if (onAction) {
      items.push({
        key: "cancel",
        label: t("salon.agenda.cancel", lang),
        icon: XCircle,
        tone: "text-red-500 hover:bg-red-500/10",
        run: () => onAction("cancelled"),
      });
    }
    if (onNoShow) {
      items.push({
        key: "client_no_show",
        label: t("salon.agenda.clientNoShow", lang),
        icon: UserX,
        tone: "text-orange-500 hover:bg-orange-500/10",
        run: () => onNoShow("client"),
      });
      items.push({
        key: "master_no_show",
        label: t("salon.agenda.masterNoShow", lang),
        icon: AlertTriangle,
        tone: "text-orange-500 hover:bg-orange-500/10",
        run: () => onNoShow("master"),
      });
    }
  }

  const interactive = items.length > 0;

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    triggerRef.current?.focus();
  }, []);

  const updatePos = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos({
      top: rect.bottom + 4,
      right: Math.max(0, window.innerWidth - rect.right),
    });
  }, []);

  const openMenu = useCallback(() => {
    if (!interactive) return;
    updatePos();
    setActiveIndex(0);
    setOpen(true);
  }, [interactive, updatePos]);

  const selectIndex = useCallback(
    (idx: number) => {
      const item = items[idx];
      if (!item) return;
      item.run();
      close();
    },
    [items, close],
  );

  // Outside-click close. The menu is portaled to document.body so it's
  // not a DOM descendant of containerRef; guard must accept clicks inside
  // either the trigger wrapper or the floating menu.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Recompute on resize, close on scroll — fixed positioning would
  // otherwise leave a stale floater detached from the trigger.
  useEffect(() => {
    if (!open) return;
    const onResize = () => updatePos();
    const onScroll = () => {
      setOpen(false);
      setActiveIndex(-1);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, updatePos]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (interactive && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIndex >= 0) selectIndex(activeIndex);
    } else if (e.key === "Tab") {
      close();
    }
  };

  const pillClass = `inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full mt-1 transition ${
    STATUS_STYLES[statusKey] ?? "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
  }`;

  if (!interactive) {
    return (
      <span data-testid="status-pill-readonly" className={pillClass}>
        {label}
      </span>
    );
  }

  const menu = (
    <ul
      ref={menuRef}
      role="menu"
      id={menuId}
      data-testid="status-pill-menu"
      aria-hidden={!open}
      style={menuPos ? { top: menuPos.top, right: menuPos.right } : undefined}
      className={`fixed z-50 min-w-[180px] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-xs shadow-lg dark:border-white/10 dark:bg-slate-900${
        open ? "" : " hidden"
      }`}
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <li
            key={item.key}
            role="menuitem"
            data-testid={`status-action-${item.key}`}
            data-active={activeIndex === i || undefined}
            onClick={() => selectIndex(i)}
            onMouseEnter={() => setActiveIndex(i)}
            className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 font-medium ${item.tone} ${
              activeIndex === i ? "bg-slate-100 dark:bg-white/10" : ""
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{item.label}</span>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div ref={containerRef} className="relative inline-block" onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        data-testid="status-pill-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => (open ? close() : openMenu())}
        className={`${pillClass} cursor-pointer hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-transparent focus:ring-current/40`}
      >
        <span>{label}</span>
        <ChevronDown size={12} className={`shrink-0 transition-transform${open ? " rotate-180" : ""}`} />
      </button>
      {typeof document !== "undefined" ? createPortal(menu, document.body) : null}
    </div>
  );
}
