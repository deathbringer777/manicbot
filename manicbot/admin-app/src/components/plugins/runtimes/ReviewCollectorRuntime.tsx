"use client";

/**
 * Review Collector runtime — Phase 3 Variant A plugin #2.
 *
 * Stores three settings on plugin_installations.settings_json:
 *   googleReviewUrl  : string (https://...)
 *   yandexReviewUrl  : string (https://...)
 *   customMessage    : string (defaults to a Russian polite ask)
 *
 * The worker callback handler reads this same row when a client posts a
 * 4⭐ or 5⭐ rating and appends the review CTA to the thank-you message.
 */

import { useEffect, useMemo, useState } from "react";
import { MessageCircleHeart, Save, ExternalLink } from "lucide-react";
import { api } from "~/trpc/react";
import { PluginRuntimeShell } from "~/components/plugins/PluginRuntimeShell";
import type { PluginRuntimeProps } from "../runtimePanels";

const DEFAULT_MESSAGE =
  "🙏 Спасибо за оценку! Если несложно, поделитесь отзывом — это сильно нам помогает.";

interface ReviewSettings {
  googleReviewUrl?: string;
  yandexReviewUrl?: string;
  customMessage?: string;
}

const URL_RE = /^https?:\/\/[^\s]{4,}$/i;

export default function ReviewCollectorRuntime({ installationId, slug }: PluginRuntimeProps) {
  const installedQ = api.plugins.getInstalled.useQuery();
  const updateSettings = api.plugins.updateSettings.useMutation();
  const utils = api.useUtils();

  const myInstall = installedQ.data?.find((x) => x.id === installationId);
  const persisted = useMemo<ReviewSettings>(() => {
    if (!myInstall?.settingsJson) return {};
    try {
      return JSON.parse(myInstall.settingsJson) as ReviewSettings;
    } catch {
      return {};
    }
  }, [myInstall?.settingsJson]);

  const [googleUrl, setGoogleUrl] = useState(persisted.googleReviewUrl ?? "");
  const [yandexUrl, setYandexUrl] = useState(persisted.yandexReviewUrl ?? "");
  const [message, setMessage] = useState(persisted.customMessage ?? DEFAULT_MESSAGE);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (persisted.googleReviewUrl !== undefined) setGoogleUrl(persisted.googleReviewUrl);
    if (persisted.yandexReviewUrl !== undefined) setYandexUrl(persisted.yandexReviewUrl);
    if (persisted.customMessage !== undefined) setMessage(persisted.customMessage);
  }, [persisted.googleReviewUrl, persisted.yandexReviewUrl, persisted.customMessage]);

  const googleValid = !googleUrl || URL_RE.test(googleUrl);
  const yandexValid = !yandexUrl || URL_RE.test(yandexUrl);
  const hasAnyUrl = !!(googleUrl || yandexUrl);

  const onSave = () => {
    if (!googleValid || !yandexValid) {
      setFlash({ kind: "err", text: "URL должен начинаться с https://" });
      return;
    }
    updateSettings.mutate(
      {
        installationId,
        settings: {
          googleReviewUrl: googleUrl.trim(),
          yandexReviewUrl: yandexUrl.trim(),
          customMessage: message.trim().slice(0, 280),
        },
      },
      {
        onSuccess: () => {
          setFlash({ kind: "ok", text: "Сохранено" });
          void utils.plugins.getInstalled.invalidate();
        },
        onError: (e) => setFlash({ kind: "err", text: e.message }),
      },
    );
  };

  return (
    <PluginRuntimeShell slug={slug} flash={flash}>
      <div className="space-y-4">
        <section className="rounded-2xl bg-white dark:bg-slate-900 p-4 border border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
            <MessageCircleHeart className="w-4 h-4 text-emerald-500 shrink-0" />
            Куда отправлять довольных клиентов
          </h3>

          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Google Business review link
              <input
                type="url"
                value={googleUrl}
                onChange={(e) => setGoogleUrl(e.target.value)}
                placeholder="https://g.page/r/..."
                data-testid="review-collector-google"
                className={`mt-1 block w-full rounded-xl border px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white ${
                  googleValid ? "border-slate-300 dark:border-slate-700" : "border-red-400"
                }`}
              />
            </label>

            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Яндекс.Карты review link
              <input
                type="url"
                value={yandexUrl}
                onChange={(e) => setYandexUrl(e.target.value)}
                placeholder="https://yandex.ru/maps/org/..."
                data-testid="review-collector-yandex"
                className={`mt-1 block w-full rounded-xl border px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white ${
                  yandexValid ? "border-slate-300 dark:border-slate-700" : "border-red-400"
                }`}
              />
            </label>

            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Сообщение к ссылке (до 280 символов)
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                maxLength={280}
                data-testid="review-collector-message"
                className="mt-1 block w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
              <span className="block mt-1 text-[10px] text-slate-400 tabular-nums">
                {message.length}/280
              </span>
            </label>
          </div>

          <button
            type="button"
            onClick={onSave}
            disabled={updateSettings.isPending}
            data-testid="review-collector-save"
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white px-4 py-2 text-sm font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            {updateSettings.isPending ? "Сохраняем…" : "Сохранить"}
          </button>
        </section>

        <section className="rounded-2xl bg-white dark:bg-slate-900 p-4 border border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">
            Превью — что увидит клиент после 5⭐
          </h3>
          <div
            className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap"
            data-testid="review-collector-preview"
          >
            {message.trim() || DEFAULT_MESSAGE}
            {hasAnyUrl && (
              <div className="mt-2 flex flex-col gap-1">
                {googleUrl && (
                  <a
                    href={googleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" /> Google
                  </a>
                )}
                {yandexUrl && (
                  <a
                    href={yandexUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" /> Яндекс
                  </a>
                )}
              </div>
            )}
            {!hasAnyUrl && (
              <p className="mt-2 text-xs text-slate-400 italic">
                Добавь хотя бы одну ссылку выше, чтобы клиент увидел CTA.
              </p>
            )}
          </div>
        </section>
      </div>
    </PluginRuntimeShell>
  );
}
