"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, ShieldCheck, AlertCircle, CheckCircle } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";

const COPY = {
  ru: {
    title: "Передача прав владения",
    kicker: "Подтверждение",
    intro: "Подтвердите передачу прав владения салоном новому владельцу. После подтверждения ваша роль изменится на «мастер».",
    confirmBtn: "Подтвердить передачу",
    confirming: "Подтверждаем...",
    success: "Передача завершена",
    successDesc: "Права владения переданы новому владельцу. Вы теперь — мастер.",
    goDashboard: "Открыть дашборд",
    noToken: "Ссылка повреждена или не содержит токена.",
    errors: {
      NOT_FOUND: "Эта ссылка недействительна.",
      CONFLICT: "Эта ссылка уже использована или передача была отменена.",
      GONE: "Срок действия ссылки истёк. Запросите передачу заново.",
      FORBIDDEN: "Передача невозможна — проверьте подписку и статус получателя.",
      BAD_REQUEST: "Передача невозможна.",
    } as Record<string, string>,
    needLogin: "Войдите в систему",
  },
  ua: {
    title: "Передача прав власника",
    kicker: "Підтвердження",
    intro: "Підтвердьте передачу прав власника салоном новому власнику. Після підтвердження ваша роль зміниться на «майстер».",
    confirmBtn: "Підтвердити передачу",
    confirming: "Підтверджуємо...",
    success: "Передачу завершено",
    successDesc: "Права власника передано новому власнику. Ви тепер — майстер.",
    goDashboard: "Відкрити дашборд",
    noToken: "Посилання пошкоджене або не містить токена.",
    errors: {
      NOT_FOUND: "Це посилання недійсне.",
      CONFLICT: "Це посилання вже використано або передачу скасовано.",
      GONE: "Термін дії посилання минув. Запросіть передачу повторно.",
      FORBIDDEN: "Передача неможлива — перевірте підписку та статус отримувача.",
      BAD_REQUEST: "Передача неможлива.",
    } as Record<string, string>,
    needLogin: "Увійдіть в систему",
  },
  en: {
    title: "Ownership transfer",
    kicker: "Confirmation",
    intro: "Confirm the transfer of salon ownership to the new owner. After confirmation, your role becomes master.",
    confirmBtn: "Confirm transfer",
    confirming: "Confirming...",
    success: "Transfer complete",
    successDesc: "Ownership has been transferred. You are now a master.",
    goDashboard: "Open dashboard",
    noToken: "The link is malformed or missing a token.",
    errors: {
      NOT_FOUND: "This link is invalid.",
      CONFLICT: "This link has already been used or the transfer was cancelled.",
      GONE: "This link has expired. Request a new transfer.",
      FORBIDDEN: "Transfer not allowed — check your subscription and the recipient's status.",
      BAD_REQUEST: "Transfer not allowed.",
    } as Record<string, string>,
    needLogin: "Log in",
  },
  pl: {
    title: "Przekazanie własności",
    kicker: "Potwierdzenie",
    intro: "Potwierdź przekazanie własności salonu nowemu właścicielowi. Po potwierdzeniu Twoja rola zmieni się na mistrza.",
    confirmBtn: "Potwierdź przekazanie",
    confirming: "Potwierdzanie...",
    success: "Przekazanie zakończone",
    successDesc: "Własność została przekazana. Jesteś teraz mistrzem.",
    goDashboard: "Otwórz panel",
    noToken: "Link jest uszkodzony lub nie zawiera tokenu.",
    errors: {
      NOT_FOUND: "Ten link jest nieprawidłowy.",
      CONFLICT: "Ten link został już użyty lub przekazanie zostało anulowane.",
      GONE: "Link wygasł. Poproś o nowe przekazanie.",
      FORBIDDEN: "Przekazanie niedozwolone — sprawdź subskrypcję i status odbiorcy.",
      BAD_REQUEST: "Przekazanie niedozwolone.",
    } as Record<string, string>,
    needLogin: "Zaloguj się",
  },
} as const;

function ConfirmInner() {
  const { lang } = useLang();
  const copy = COPY[lang];
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const confirm = api.ownership.confirmTransfer.useMutation({
    onSuccess: () => setStatus("ok"),
    onError: (err) => {
      const code = err.data?.code ?? "BAD_REQUEST";
      setErrorMsg(copy.errors[code] ?? err.message);
      setStatus("error");
    },
  });

  if (!token) {
    return (
      <Card title={copy.title}>
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300">{copy.noToken}</p>
        </div>
      </Card>
    );
  }

  if (status === "ok") {
    return (
      <Card title={copy.success}>
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 mb-4">
          <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />
          <p className="text-sm text-emerald-700 dark:text-emerald-200">{copy.successDesc}</p>
        </div>
        <Link href="/dashboard" className="block w-full rounded-xl bg-gradient-to-br from-violet-600 to-cyan-500 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-md hover:opacity-95">
          {copy.goDashboard}
        </Link>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card title={copy.title}>
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 mb-4">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300">{errorMsg}</p>
        </div>
        <Link href="/login" className="block text-center text-sm text-cyan-700 dark:text-cyan-300 hover:underline">
          {copy.needLogin}
        </Link>
      </Card>
    );
  }

  return (
    <Card title={copy.title}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-5">{copy.intro}</p>
      <button
        type="button"
        disabled={confirm.isPending}
        onClick={() => confirm.mutate({ token })}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-violet-600 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:opacity-95 disabled:opacity-60"
      >
        {confirm.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
        {confirm.isPending ? copy.confirming : copy.confirmBtn}
      </button>
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-6 shadow-xl">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-4">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export default function OwnershipConfirmPage() {
  return (
    <Suspense fallback={<Card title="..."><Loader2 className="h-5 w-5 animate-spin mx-auto" /></Card>}>
      <ConfirmInner />
    </Suspense>
  );
}
