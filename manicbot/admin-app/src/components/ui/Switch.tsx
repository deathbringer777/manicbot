"use client";

export type SwitchSize = "default" | "sm" | "xs";
export type SwitchTone = "brand" | "emerald";

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  size?: SwitchSize;
  tone?: SwitchTone;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "data-testid"?: string;
  "data-channel"?: string;
}

const TRACK_SIZE: Record<SwitchSize, string> = {
  default: "h-6 w-11",
  sm: "h-5 w-9",
  xs: "h-4 w-7",
};

const THUMB_SIZE: Record<SwitchSize, string> = {
  default: "h-5 w-5",
  sm: "h-4 w-4",
  xs: "h-3 w-3",
};

const THUMB_TRANSLATE_OFF: Record<SwitchSize, string> = {
  default: "translate-x-0.5",
  sm: "translate-x-0.5",
  xs: "translate-x-0.5",
};

const THUMB_TRANSLATE_ON: Record<SwitchSize, string> = {
  default: "translate-x-[22px]",
  sm: "translate-x-[18px]",
  xs: "translate-x-[14px]",
};

const TONE_ON: Record<SwitchTone, string> = {
  brand: "bg-brand-500",
  emerald: "bg-emerald-500",
};

const TRACK_OFF = "bg-slate-300 dark:bg-slate-600";

export function Switch({
  checked,
  onChange,
  size = "default",
  tone = "brand",
  disabled = false,
  className = "",
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "data-testid": dataTestId,
  "data-channel": dataChannel,
}: SwitchProps) {
  const trackBg = checked ? TONE_ON[tone] : TRACK_OFF;
  const thumbTranslate = checked ? THUMB_TRANSLATE_ON[size] : THUMB_TRANSLATE_OFF[size];

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      id={id}
      disabled={disabled}
      data-testid={dataTestId}
      data-channel={dataChannel}
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
      className={`relative inline-flex shrink-0 items-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900 disabled:opacity-60 disabled:cursor-not-allowed ${TRACK_SIZE[size]} ${trackBg} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`absolute rounded-full bg-white shadow-sm ring-1 ring-slate-900/10 dark:ring-white/15 transition-transform duration-150 ease-out motion-reduce:transition-none ${THUMB_SIZE[size]} ${thumbTranslate}`}
      />
    </button>
  );
}
