"use client";

import { useEffect } from "react";
import { reportClientError } from "~/lib/clientErrorReport";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the crash to ops — without this, every React #300 / runtime
    // exception lives only in the user's browser console and is invisible
    // to anyone but the affected user.
    reportClientError("global-error", error);
  }, [error]);

  return (
    <html lang="ru">
      <body className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white">
        <div className="text-center px-4">
          <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
          <p className="text-slate-400 mb-6 text-sm">An unexpected error occurred.</p>
          <button
            onClick={reset}
            className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
