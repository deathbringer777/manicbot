"use client";

/**
 * CreateSalonModal — create an additional salon (multi-salon, MAX plan).
 *
 * Calls salon.createOwnedSalon, which atomically creates the tenant + a
 * tenant_roles(role='tenant_owner') row and sets the caller's active_tenant_id
 * to the new salon. We then refresh the NextAuth session (so the JWT
 * re-resolves tenantId/role for the new salon), wipe tRPC caches, and land on
 * the new salon's dashboard — mirroring TenantSwitcher.choose().
 *
 * Gating is enforced server-side (max_plan_required / owned_salon_limit_reached);
 * the callers only SHOW this modal to MAX owners.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Building2, Plus, Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";

interface Props {
  onClose: () => void;
}

export function CreateSalonModal({ onClose }: Props) {
  const { lang } = useLang();
  const router = useRouter();
  const { update } = useSession();
  const utils = api.useUtils();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = api.salon.createOwnedSalon.useMutation({
    onSuccess: async () => {
      // createOwnedSalon already pointed active_tenant_id at the new salon.
      await update();
      await utils.invalidate();
      router.push("/dashboard");
    },
    onError: (e) => setError(e.message),
  });

  const labels = (() => {
    switch (lang) {
      case "ru":
        return {
          title: "Новый салон",
          namePh: "Например, «Мой второй салон»",
          hint: "Вы станете владельцем нового салона. Переключаться между салонами можно в шапке. Тариф MAX покрывает все ваши салоны.",
          submit: "Создать салон",
          creating: "Создаём…",
          cancel: "Отмена",
          errMax: "Несколько салонов доступны только на тарифе MAX.",
          errLimit: "Достигнут лимит салонов на аккаунт.",
          errOther: "Не удалось создать салон. Попробуйте позже.",
        };
      case "ua":
        return {
          title: "Новий салон",
          namePh: "Наприклад, «Мій другий салон»",
          hint: "Ви станете власником нового салону. Перемикатися між салонами можна у шапці. Тариф MAX покриває всі ваші салони.",
          submit: "Створити салон",
          creating: "Створюємо…",
          cancel: "Скасувати",
          errMax: "Декілька салонів доступні лише на тарифі MAX.",
          errLimit: "Досягнуто ліміту салонів на акаунт.",
          errOther: "Не вдалося створити салон. Спробуйте пізніше.",
        };
      case "pl":
        return {
          title: "Nowy salon",
          namePh: "Np. „Mój drugi salon”",
          hint: "Zostaniesz właścicielem nowego salonu. Przełączaj się między salonami w nagłówku. Plan MAX obejmuje wszystkie Twoje salony.",
          submit: "Utwórz salon",
          creating: "Tworzenie…",
          cancel: "Anuluj",
          errMax: "Wiele salonów jest dostępnych tylko w planie MAX.",
          errLimit: "Osiągnięto limit salonów na konto.",
          errOther: "Nie udało się utworzyć salonu. Spróbuj później.",
        };
      default:
        return {
          title: "New salon",
          namePh: 'e.g. "My second salon"',
          hint: "You'll become the owner of the new salon. Switch between salons in the header. The MAX plan covers all your salons.",
          submit: "Create salon",
          creating: "Creating…",
          cancel: "Cancel",
          errMax: "Multiple salons are available on the MAX plan only.",
          errLimit: "You've reached the salon limit for this account.",
          errOther: "Could not create the salon. Try again later.",
        };
    }
  })();

  const isValid = name.trim().length > 0;

  function errorText(message: string): string {
    if (message.includes("max_plan_required")) return labels.errMax;
    if (message.includes("owned_salon_limit_reached")) return labels.errLimit;
    return labels.errOther;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
          <div
            className="h-9 w-9 rounded-xl flex items-center justify-center text-white"
            style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
          >
            <Building2 className="h-4 w-4" />
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{labels.title}</h3>
        </div>

        <div className="p-5 space-y-3">
          <input
            type="text"
            autoFocus
            value={name}
            maxLength={200}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && isValid && !create.isPending) create.mutate({ name: name.trim() });
            }}
            placeholder={labels.namePh}
            data-testid="create-salon-name"
            className="w-full rounded-xl px-3 py-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/60"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{labels.hint}</p>

          {error && (
            <div
              className="rounded-xl px-3 py-2 text-sm border bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
              role="status"
            >
              {errorText(error)}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              {labels.cancel}
            </button>
            <button
              type="button"
              onClick={() => create.mutate({ name: name.trim() })}
              disabled={!isValid || create.isPending}
              data-testid="create-salon-submit"
              className="flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
            >
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {create.isPending ? labels.creating : labels.submit}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
