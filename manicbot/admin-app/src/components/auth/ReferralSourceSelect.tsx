"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { authFieldClassName } from "./AuthShell";

type OptionValue = "google" | "instagram" | "telegram" | "friends" | "other";

interface Option {
  value: OptionValue;
  label: string;
  color: string;
}

interface ReferralCopy {
  referralPlaceholder: string;
  referralGoogle: string;
  referralInstagram: string;
  referralTelegram: string;
  referralFriends: string;
  referralOther: string;
  referralNotePlaceholder: string;
}

interface Props {
  value: string;
  note: string;
  onChange: (value: string) => void;
  onNoteChange: (note: string) => void;
  copy: ReferralCopy;
}

export function ReferralSourceSelect({ value, note, onChange, onNoteChange, copy }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const options: Option[] = [
    { value: "google", label: copy.referralGoogle, color: "#4285F4" },
    { value: "instagram", label: copy.referralInstagram, color: "#E4405F" },
    { value: "telegram", label: copy.referralTelegram, color: "#26A5E4" },
    { value: "friends", label: copy.referralFriends, color: "#a78bfa" },
    { value: "other", label: copy.referralOther, color: "#64748b" },
  ];

  const selected = options.find((o) => o.value === value) ?? null;

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen]);

  function handleSelect(opt: Option) {
    onChange(opt.value);
    setIsOpen(false);
    // Clear note when switching away from "other"
    if (opt.value !== "other") onNoteChange("");
  }

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className={`${authFieldClassName} flex items-center justify-between gap-2 text-left`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {selected ? (
            <>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: selected.color }}
              />
              <span className="truncate">{selected.label}</span>
            </>
          ) : (
            <span className="text-slate-400 dark:text-slate-500">{copy.referralPlaceholder}</span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 dark:text-slate-500 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-2xl border border-white/10 bg-white shadow-[0_20px_60px_-18px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-slate-950/95 dark:shadow-[0_20px_60px_-18px_rgba(8,145,178,0.35)]">
          <ul role="listbox" className="p-1.5">
            {options.map((opt) => {
              const isSelected = value === opt.value;
              return (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(opt)}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                    isSelected
                      ? "bg-violet-50 text-violet-900 dark:bg-violet-500/15 dark:text-violet-100"
                      : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/[0.06]"
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: opt.color }}
                  />
                  <span className="flex-1">{opt.label}</span>
                  {isSelected && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-violet-500 dark:text-violet-300" />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* "Other" free-text note — animates in/out */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          value === "other" ? "mt-2 max-h-20 opacity-100" : "max-h-0 opacity-0 pointer-events-none"
        }`}
      >
        <input
          type="text"
          maxLength={200}
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder={copy.referralNotePlaceholder}
          className={authFieldClassName}
          tabIndex={value === "other" ? 0 : -1}
        />
      </div>
    </div>
  );
}
