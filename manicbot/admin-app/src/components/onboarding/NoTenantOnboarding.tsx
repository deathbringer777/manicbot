"use client";

import { useState } from "react";
import { Building2, Clock, UserPlus } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

export function NoTenantOnboarding({ role }: { role: "tenant_owner" | "master" }) {
  if (role === "master") return <MasterWaiting />;
  return <OwnerSetup />;
}

function OwnerSetup() {
  const { lang } = useLang();
  const [name, setName] = useState("");
  const createMut = api.webUsers.createMyTenant.useMutation({
    onSuccess: () => {
      window.location.reload();
    },
  });

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg dark:border-white/10 dark:bg-slate-800/80">
        <div className="mb-6 flex items-center justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900/30">
            <Building2 className="h-7 w-7 text-brand-600 dark:text-brand-400" />
          </div>
        </div>
        <h2 className="mb-2 text-center text-xl font-semibold text-slate-900 dark:text-white">
          {t("onboarding.ownerSetup", lang)}
        </h2>
        <p className="mb-6 text-center text-sm text-slate-500 dark:text-slate-400">
          {t("onboarding.ownerDesc", lang)}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && !createMut.isPending) {
              createMut.mutate({ name: name.trim() });
            }
          }}
        >
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t("onboarding.salonNameLabel", lang)}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nail Studio"
            maxLength={100}
            className="mb-1 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-slate-700 dark:text-white"
            autoFocus
          />
          <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
            {t("onboarding.salonNameHint", lang)}
          </p>
          {createMut.error && (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {createMut.error.message}
            </p>
          )}
          <button
            type="submit"
            disabled={!name.trim() || createMut.isPending}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {createMut.isPending ? t("common.loading", lang) : t("onboarding.createSalon", lang)}
          </button>
        </form>
      </div>
    </div>
  );
}

function MasterWaiting() {
  const { lang } = useLang();

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg dark:border-white/10 dark:bg-slate-800/80">
        <div className="mb-6 flex items-center justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
            <Clock className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          </div>
        </div>
        <h2 className="mb-2 text-center text-xl font-semibold text-slate-900 dark:text-white">
          {t("onboarding.masterWaiting", lang)}
        </h2>
        <p className="mb-6 text-center text-sm text-slate-500 dark:text-slate-400">
          {t("onboarding.masterDesc", lang)}
        </p>
        <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-4 dark:bg-slate-700/50">
          <UserPlus className="h-5 w-5 shrink-0 text-slate-400" />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t("onboarding.contactOwner", lang)}
          </p>
        </div>
      </div>
    </div>
  );
}
