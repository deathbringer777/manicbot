import type { CSSProperties } from "react";

export function TestBadge({ className = "", title }: { className?: string; title?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded bg-yellow-300 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-900 ${className}`}
      title={title ?? "Тестовый аккаунт. Создан seed-test-accounts."}
      style={{ lineHeight: 1.2 } as CSSProperties}
    >
      TEST
    </span>
  );
}
