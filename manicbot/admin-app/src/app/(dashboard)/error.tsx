"use client";

import { useEffect } from "react";
import { reportClientError } from "~/lib/clientErrorReport";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError("dashboard-error", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center px-4">
        <h2 className="text-xl font-bold text-foreground mb-2">Something went wrong</h2>
        <p className="text-muted-foreground mb-6 text-sm">An error occurred while loading this page.</p>
        <button
          onClick={reset}
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
