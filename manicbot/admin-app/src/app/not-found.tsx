"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function NotFound() {
  const router = useRouter();

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      router.push("/");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="text-center px-4">
        <h1 className="text-6xl font-extrabold text-slate-300 dark:text-slate-700">404</h1>
        <p className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">Page not found</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          The page you are looking for does not exist.
        </p>
        <button
          onClick={handleBack}
          className="mt-6 inline-block rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
        >
          Back
        </button>
        <div className="mt-3">
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
