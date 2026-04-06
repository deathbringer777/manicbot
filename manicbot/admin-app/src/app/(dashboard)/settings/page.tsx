"use client";

import { Suspense } from "react";
import SettingsPageClient from "./SettingsPageClient";

export const runtime = "edge";

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-brand-500" /></div>}>
      <SettingsPageClient />
    </Suspense>
  );
}
