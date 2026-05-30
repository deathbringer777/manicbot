"use client";

import { useMemo, useState } from "react";
import { Megaphone, Users, X } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t, type TranslationKey } from "~/lib/i18n";

type Scope = "all" | "by_plan" | "by_billing_status";
type Plan = "start" | "pro" | "max";
type Status = "trialing" | "active" | "grace" | "expired";

interface AudienceState {
  scope: Scope;
  plans: Plan[];
  statuses: Status[];
}

interface Props {
  onClose: () => void;
  onSent: () => void;
}

const PLAN_LABELS: Record<Plan, string> = {
  start: "Start",
  pro: "Pro",
  max: "Max",
};

const STATUS_LABEL_KEYS: Record<Status, TranslationKey> = {
  trialing: "messenger.broadcast.statusTrialing",
  active: "messenger.broadcast.statusActive",
  grace: "messenger.broadcast.statusGrace",
  expired: "messenger.broadcast.statusExpired",
};

/**
 * Broadcast composer modal.
 *
 * Two-step flow:
 *   1. Pick audience + write title/body
 *   2. Click "Предпросмотр" — shows recipient count + sample
 *   3. Click "Отправить" — fires the broadcast mutation
 *
 * Audience is union-typed at the tRPC boundary (matches AUDIENCE_FILTER zod
 * discriminatedUnion in platformMessenger.ts). We narrow client-side before
 * sending.
 */
export function BroadcastComposer({ onClose, onSent }: Props) {
  const { lang } = useLang();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<AudienceState>({
    scope: "all",
    plans: ["pro", "max"],
    statuses: ["active"],
  });

  const filter = useMemo(() => buildFilter(audience), [audience]);

  const previewQ = api.platformMessenger.previewAudience.useQuery(
    { audience: filter },
    { enabled: !!filter, staleTime: 0 },
  );

  const broadcastMutation = api.platformMessenger.broadcast.useMutation({
    onSuccess: () => onSent(),
  });

  function onSubmit() {
    const trimmed = body.trim();
    if (!trimmed || broadcastMutation.isPending) return;
    broadcastMutation.mutate({
      title: title.trim() || undefined,
      body: trimmed,
      audience: filter,
    });
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-md">
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 dark:bg-slate-900"
        data-testid="broadcast-composer"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-fuchsia-500/15 text-fuchsia-600">
              <Megaphone className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t("messenger.broadcast.title", lang)}
              </div>
              <div className="text-[11px] text-slate-500">
                {t("messenger.broadcast.subtitle", lang)}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label={t("messenger.newThread.close", lang)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              {t("messenger.broadcast.titleLabel", lang)}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={t("messenger.broadcast.titlePlaceholder", lang)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-fuchsia-400 focus:outline-none focus:ring-1 focus:ring-fuchsia-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              {t("messenger.broadcast.messageLabel", lang)}
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              maxLength={4000}
              placeholder={t("messenger.broadcast.messagePlaceholder", lang)}
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-fuchsia-400 focus:outline-none focus:ring-1 focus:ring-fuchsia-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <div className="mt-1 text-right text-[10px] text-slate-400">
              {body.length}/4000
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              {t("messenger.broadcast.audience", lang)}
            </label>
            <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={audience.scope === "all"}
                  onChange={() => setAudience({ ...audience, scope: "all" })}
                />
                <span>{t("messenger.broadcast.audienceAll", lang)}</span>
              </label>

              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={audience.scope === "by_plan"}
                  onChange={() => setAudience({ ...audience, scope: "by_plan" })}
                />
                <span>{t("messenger.broadcast.audienceByPlan", lang)}</span>
              </label>
              {audience.scope === "by_plan" && (
                <div className="ml-6 flex flex-wrap gap-2">
                  {(Object.keys(PLAN_LABELS) as Plan[]).map((p) => {
                    const checked = audience.plans.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() =>
                          setAudience({
                            ...audience,
                            plans: checked
                              ? audience.plans.filter((x) => x !== p)
                              : [...audience.plans, p],
                          })
                        }
                        className={`rounded-full px-3 py-1 text-xs ${
                          checked
                            ? "bg-fuchsia-500 text-white"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        }`}
                      >
                        {PLAN_LABELS[p]}
                      </button>
                    );
                  })}
                </div>
              )}

              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={audience.scope === "by_billing_status"}
                  onChange={() => setAudience({ ...audience, scope: "by_billing_status" })}
                />
                <span>{t("messenger.broadcast.audienceByBilling", lang)}</span>
              </label>
              {audience.scope === "by_billing_status" && (
                <div className="ml-6 flex flex-wrap gap-2">
                  {(Object.keys(STATUS_LABEL_KEYS) as Status[]).map((s) => {
                    const checked = audience.statuses.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() =>
                          setAudience({
                            ...audience,
                            statuses: checked
                              ? audience.statuses.filter((x) => x !== s)
                              : [...audience.statuses, s],
                          })
                        }
                        className={`rounded-full px-3 py-1 text-xs ${
                          checked
                            ? "bg-fuchsia-500 text-white"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        }`}
                      >
                        {t(STATUS_LABEL_KEYS[s], lang)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <Users className="h-3.5 w-3.5" />
              {previewQ.isLoading ? (
                <span>{t("messenger.broadcast.counting", lang)}</span>
              ) : previewQ.data ? (
                <span>
                  {t("messenger.broadcast.recipients", lang)}{" "}
                  <strong>{previewQ.data.count}</strong>
                  {previewQ.data.sample.length > 0 && (
                    <>
                      {" "}— {t("messenger.broadcast.forExample", lang)}{": "}
                      {previewQ.data.sample
                        .slice(0, 5)
                        .map((r) => r.name ?? r.email ?? r.id)
                        .join(", ")}
                      {previewQ.data.count > 5 && "…"}
                    </>
                  )}
                </span>
              ) : (
                <span className="text-rose-500">{t("messenger.broadcast.countFailed", lang)}</span>
              )}
            </div>
          </div>

          {broadcastMutation.error && (
            <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
              {broadcastMutation.error.message}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-900/40">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {t("messenger.broadcast.cancel", lang)}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={
              !body.trim() ||
              !previewQ.data?.count ||
              previewQ.data.count === 0 ||
              broadcastMutation.isPending
            }
            className="rounded-xl bg-fuchsia-500 px-4 py-2 text-sm font-medium text-white hover:bg-fuchsia-600 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="broadcast-send"
          >
            {broadcastMutation.isPending
              ? t("messenger.broadcast.sending", lang)
              : `${t("messenger.composer.send", lang)} (${previewQ.data?.count ?? 0})`}
          </button>
        </div>
      </div>
    </div>
  );
}

function buildFilter(a: AudienceState):
  | { scope: "all" }
  | { scope: "by_plan"; plans: Plan[] }
  | { scope: "by_billing_status"; statuses: Status[] } {
  if (a.scope === "by_plan") {
    return { scope: "by_plan", plans: a.plans.length ? a.plans : ["pro", "max"] };
  }
  if (a.scope === "by_billing_status") {
    return {
      scope: "by_billing_status",
      statuses: a.statuses.length ? a.statuses : ["active"],
    };
  }
  return { scope: "all" };
}
