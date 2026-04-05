"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useLang } from "~/components/LangContext";
import { api } from "~/trpc/react";
import { AuthShell } from "~/components/auth/AuthShell";
import { authCopy } from "~/components/auth/copy";

function ConfirmEmailChangeInner() {
  const { lang } = useLang();
  const copy = authCopy[lang];
  const v = copy.confirmEmailChange;
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err" | "missing">("idle");

  const { mutateAsync } = api.webUsers.confirmEmailChange.useMutation();

  useEffect(() => {
    if (!token) {
      setState("missing");
      return;
    }
    let cancelled = false;
    setState("loading");
    void (async () => {
      try {
        await mutateAsync({ token });
        if (!cancelled) setState("ok");
      } catch {
        if (!cancelled) setState("err");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, mutateAsync]);

  const body =
    state === "missing" ? (
      <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
        {v.missingToken}
      </p>
    ) : state === "loading" || state === "idle" ? (
      <p className="text-sm text-slate-600 dark:text-slate-300">{v.verifying}</p>
    ) : state === "ok" ? (
      <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
        {v.success}
      </p>
    ) : (
      <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-200">
        {v.error}
      </p>
    );

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
      {body}
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
