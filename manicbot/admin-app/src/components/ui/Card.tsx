import type { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: "sm" | "md" | "lg" | "none";
}

const paddingMap = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

export function Card({ className = "", padding = "md", children, ...props }: CardProps) {
  return (
    <div
      className={`bg-white dark:bg-slate-800/70 border border-[#e5e7eb] dark:border-white/[0.07] rounded-xl shadow-[0_1px_4px_0_rgba(0,0,0,0.04)] dark:shadow-[0_4px_16px_0_rgba(0,0,0,0.2)] ${paddingMap[padding]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
