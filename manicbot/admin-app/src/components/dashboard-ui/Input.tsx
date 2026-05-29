"use client";

import { useId } from "react";

/**
 * Labelled input field used across dashboard-ui forms.
 *
 * Generates a stable unique `id` via React's `useId` so the `<label htmlFor>`
 * properly associates with the `<input>` — WCAG 1.3.1 (Info and Relationships)
 * and 1.3.5 (Identify Input Purpose). The id is stable within a React tree
 * but never collides across multiple Input instances on the same page.
 */
export function Input({ label, value, onChange, type = "text", placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div>
      <label
        htmlFor={id}
        className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-1 block"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-slate-400 dark:placeholder:text-slate-600"
      />
    </div>
  );
}
