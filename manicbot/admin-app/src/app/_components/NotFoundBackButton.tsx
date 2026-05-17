"use client";

import { useRouter } from "next/navigation";

export default function NotFoundBackButton() {
  const router = useRouter();

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      router.push("/");
    }
  }

  return (
    <button
      onClick={handleBack}
      className="mt-6 inline-block rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
    >
      Back
    </button>
  );
}
