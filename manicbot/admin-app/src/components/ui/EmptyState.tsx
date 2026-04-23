import type { ReactNode, FC } from "react";

interface EmptyStateProps {
  illustration?: ReactNode;
  illustrationVariant?: "calendar" | "inbox" | "users" | "puzzle" | "chart";
  title: string;
  subtitle?: string;
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  className?: string;
}

// Simple friendly inline SVGs — no external dependencies
function CalendarIllustration() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="10" y="20" width="100" height="90" rx="10" fill="#e8f5f0" stroke="#0b9b6b" strokeWidth="2"/>
      <rect x="10" y="20" width="100" height="28" rx="10" fill="#0b9b6b"/>
      <rect x="10" y="38" width="100" height="10" rx="0" fill="#0b9b6b"/>
      <circle cx="35" cy="18" r="6" fill="#065f46" stroke="white" strokeWidth="2"/>
      <circle cx="85" cy="18" r="6" fill="#065f46" stroke="white" strokeWidth="2"/>
      {[0,1,2,3,4,5,6].map(i => (
        <circle key={i} cx={20 + i * 14} cy={64} r="5" fill={i === 3 ? "#0b9b6b" : "#e5e7eb"} />
      ))}
      {[0,1,2,3,4,5,6].map(i => (
        <circle key={i} cx={20 + i * 14} cy={82} r="5" fill="#f3f4f6" />
      ))}
      {[0,1,2,3,4].map(i => (
        <circle key={i} cx={20 + i * 14} cy={100} r="5" fill="#f3f4f6" />
      ))}
    </svg>
  );
}

function InboxIllustration() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="10" y="30" width="100" height="70" rx="10" fill="#e8f5f0" stroke="#0b9b6b" strokeWidth="2"/>
      <path d="M10 42 L60 72 L110 42" stroke="#0b9b6b" strokeWidth="2" fill="none"/>
      <circle cx="88" cy="28" r="14" fill="#0b9b6b"/>
      <path d="M82 28 L87 33 L94 22" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

function UsersIllustration() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="60" cy="38" r="20" fill="#e8f5f0" stroke="#0b9b6b" strokeWidth="2"/>
      <path d="M20 100 C20 78 40 65 60 65 C80 65 100 78 100 100" fill="#e8f5f0" stroke="#0b9b6b" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="60" cy="38" r="12" fill="#0b9b6b"/>
      <circle cx="28" cy="48" r="12" fill="#d1fae5" stroke="#0b9b6b" strokeWidth="1.5"/>
      <circle cx="92" cy="48" r="12" fill="#d1fae5" stroke="#0b9b6b" strokeWidth="1.5"/>
    </svg>
  );
}

function PuzzleIllustration() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="15" y="15" width="38" height="38" rx="6" fill="#e8f5f0" stroke="#0b9b6b" strokeWidth="2"/>
      <rect x="67" y="15" width="38" height="38" rx="6" fill="#d1fae5" stroke="#0b9b6b" strokeWidth="2"/>
      <rect x="15" y="67" width="38" height="38" rx="6" fill="#d1fae5" stroke="#0b9b6b" strokeWidth="2"/>
      <rect x="67" y="67" width="38" height="38" rx="6" fill="#e8f5f0" stroke="#0b9b6b" strokeWidth="2"/>
      <circle cx="60" cy="60" r="10" fill="#0b9b6b"/>
    </svg>
  );
}

function ChartIllustration() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="10" y="10" width="100" height="100" rx="10" fill="#e8f5f0"/>
      <rect x="25" y="70" width="14" height="30" rx="3" fill="#0b9b6b"/>
      <rect x="48" y="50" width="14" height="50" rx="3" fill="#34d399"/>
      <rect x="71" y="40" width="14" height="60" rx="3" fill="#0b9b6b"/>
      <rect x="94" y="30" width="14" height="70" rx="3" fill="#34d399"/>
      <line x1="18" y1="25" x2="18" y2="105" stroke="#e5e7eb" strokeWidth="1.5"/>
      <line x1="18" y1="105" x2="112" y2="105" stroke="#e5e7eb" strokeWidth="1.5"/>
    </svg>
  );
}

const illustrations: Record<string, FC> = {
  calendar: CalendarIllustration,
  inbox:    InboxIllustration,
  users:    UsersIllustration,
  puzzle:   PuzzleIllustration,
  chart:    ChartIllustration,
};

export function EmptyState({
  illustration,
  illustrationVariant = "calendar",
  title,
  subtitle,
  action,
  className = "",
}: EmptyStateProps) {
  const Illustration = illustrations[illustrationVariant];

  return (
    <div className={`flex flex-col items-center justify-center text-center py-16 px-6 ${className}`}>
      <div className="mb-6 opacity-90">
        {illustration ?? <Illustration />}
      </div>
      <h3 className="text-2xl font-bold text-[#1a1a2e] dark:text-white mb-2">
        {title}
      </h3>
      {subtitle && (
        <p className="text-base text-[#6b7280] dark:text-slate-400 max-w-sm">
          {subtitle}
        </p>
      )}
      {action && (
        <div className="mt-6">
          {action.href ? (
            <a
              href={action.href}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#1a1a2e] dark:bg-white text-white dark:text-[#1a1a2e] text-sm font-semibold hover:bg-[#0f172a] dark:hover:bg-slate-100 transition-colors"
            >
              {action.label}
            </a>
          ) : (
            <button
              type="button"
              onClick={action.onClick}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#1a1a2e] dark:bg-white text-white dark:text-[#1a1a2e] text-sm font-semibold hover:bg-[#0f172a] dark:hover:bg-slate-100 transition-colors"
            >
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
