"use client";

/**
 * #N1 — DEPRECATED entry point. The legacy URL-based email-change confirmation
 * was migrated to a 6-digit code entered in the settings panel. Old emails
 * with `?token=…` links may still hit this route during the 1h TTL window.
 * We surface a clear "use the code in your settings" message rather than
 * pretending to handle the old flow.
 */
import Link from "next/link";
import { Suspense } from "react";
import { useLang } from "~/components/LangContext";
import { AuthShell } from "~/components/auth/AuthShell";
import { authCopy } from "~/components/auth/copy";

function ConfirmEmailChangeInner() {
  const { lang } = useLang();
  const copy = authCopy[lang];
  const v = copy.confirmEmailChange;

  return (
    <AuthShell
      eyebrow={v.kicker}
      title={v.title}
      description={v.description}
      panelTitle={v.panelTitle}
      panelDescription={v.panelDescription}
      footer={
        <p className="text-center text-sm">
          <Link
            href="/login"
            className="font-medium text-cyan-700 transition hover:text-slate-900 dark:text-cyan-200 dark:hover:text-white"
          >
            {v.goLogin}
          </Link>
        </p>
      }
    >
      <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
        {v.useSettingsPanel ?? v.missingToken}
      </p>
      <p className="mt-3 text-center text-sm">
        <Link
          href="/settings"
          className="font-medium text-cyan-700 transition hover:text-slate-900 dark:text-cyan-200 dark:hover:text-white"
        >
          {v.openSettings ?? v.goLogin}
        </Link>
      </p>
    </AuthShell>
  );
}

export default function ConfirmEmailChangePage() {
  const { lang } = useLang();
  const copy = authCopy[lang];
  return (
    <Suspense
      fallback={
        <AuthShell
          eyebrow={copy.confirmEmailChange.kicker}
          title={copy.confirmEmailChange.title}
          description={copy.confirmEmailChange.description}
          panelTitle={copy.confirmEmailChange.panelTitle}
          panelDescription={copy.confirmEmailChange.panelDescription}
          footer={null}
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">{copy.confirmEmailChange.verifying}</p>
        </AuthShell>
      }
    >
      <ConfirmEmailChangeInner />
    </Suspense>
  );
}
