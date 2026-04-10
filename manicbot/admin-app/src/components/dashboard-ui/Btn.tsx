"use client";

export function Btn({ children, onClick, variant = "primary", disabled, className = "" }: {
  children: React.ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "danger";
  disabled?: boolean; className?: string;
}) {
  const styles = {
    primary: "bg-brand-500 text-white border border-brand-600 hover:bg-brand-600 shadow-sm",
    ghost: "bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10 hover:bg-slate-200 dark:hover:bg-white/10",
    danger: "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30",
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all disabled:opacity-40 flex items-center gap-1.5 ${styles[variant]} ${className}`}>
      {children}
    </button>
  );
}
