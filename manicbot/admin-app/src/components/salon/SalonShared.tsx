"use client";

// Re-export all primitives from the canonical dashboard-ui location.
// Existing imports throughout the codebase (e.g. `from "~/components/salon/SalonShared"`)
// continue to work without changes.

export { StatCard } from "~/components/dashboard-ui/StatCard";
export { AptCard, STATUS_STYLES, APT_BORDER } from "~/components/dashboard-ui/AptCard";
export { SectionHeader } from "~/components/dashboard-ui/SectionHeader";
export { Btn } from "~/components/dashboard-ui/Btn";
export { Input } from "~/components/dashboard-ui/Input";
