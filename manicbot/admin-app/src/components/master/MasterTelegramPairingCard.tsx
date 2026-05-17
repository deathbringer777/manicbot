"use client";

/**
 * Master-side "Привязать Telegram" card on the Master dashboard.
 *
 * Renders three states:
 *
 *   1. Already paired         → green pill + "Отвязать" button.
 *   2. Pending code             → blue card with copyable deep-link + remaining time.
 *   3. Not paired, no code      → CTA "Сгенерировать ссылку".
 *
 * For masters whose primary chatId is already a real Telegram chat
 * (origin='invited_telegram' or pre-0023 legacy), `isSynthetic === false`
 * and `telegramChatId === null` — we hide the card entirely because they
 * already get bot notifications via their primary chatId.
 */

import { useState } from "react";
import { Send, Loader2, Copy, Check, Unlink } from "lucide-react";
import { api } from "~/trpc/react";

interface Props {
  tenantId: string;
  masterId: number;
}

function fmtExpiresIn(expiresAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = expiresAt - now;
  if (diff <= 0) return "истёк";
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days > 0) return `${days} дн.`;
  if (hours > 0) return `${hours} ч.`;
  const mins = Math.floor(diff / 60);
  return `${Math.max(1, mins)} мин.`;
}

export function MasterTelegramPairingCard({ tenantId, masterId }: Props) {
  const utils = api.useUtils();
  const stateQ = api.master.getMyPairingState.useQuery(
    { tenantId, masterId },
    { refetchInterval: 30_000 },
  );
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [generatedExpiresAt, setGeneratedExpiresAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const mintMut = api.master.requestPairingCode.useMutation({
    onSuccess: async (res) => {
      setGeneratedLink(res.deepLink);
      setGeneratedExpiresAt(res.expiresAt);
      await utils.master.getMyPairingState.invalidate({ tenantId, masterId });
    },
  });
  const unpairMut = api.master.unpairTelegram.useMutation({
    onSuccess: async () => {
      setGeneratedLink(null);
      setGeneratedExpiresAt(null);
      await utils.master.getMyPairingState.invalidate({ tenantId, masterId });
    },
  });

  if (stateQ.isLoading) {
    return (
      <div className="glass-card rounded-2xl p-4 flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
      </div>
    );
  }
  if (!stateQ.data) return null;
  const { telegramChatId, isSynthetic, hasActiveCode, activeCodeExpiresAt, botUsername } = stateQ.data;

  // Real-TG-primary masters (origin='invited_telegram' or legacy):
  // they don't need this surface — they already receive bot pings on
  // their primary chatId. Hide the card to keep the dashboard quiet.
  if (!isSynthetic && telegramChatId === null) {
    return null;
  }

  // Salon hasn't connected a bot yet — show the friendly placeholder so
  // the master knows what to ask for.
  if (!botUsername && telegramChatId === null) {
    return (
      <div className="glass-card rounded-2xl p-4 space-y-2" data-testid="pair-tg-no-bot">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-slate-500" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Telegram-бот</h3>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Салон ещё не подключил свой Telegram-бот. Попроси салон подключить бота — потом ты сможешь привязать здесь свой Telegram и получать уведомления о новых записях прямо в чат.
        </p>
      </div>
    );
  }

  // State 1: already paired.
  if (telegramChatId !== null) {
    return (
      <div className="glass-card rounded-2xl p-4 space-y-3" data-testid="pair-tg-bound">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Send className="h-4 w-4 text-emerald-500" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Telegram привязан</h3>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
            <Check className="h-3 w-3" />
            ID: {telegramChatId}
          </span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Уведомления о новых записях будут приходить тебе в Telegram. Открой бота салона — увидишь свою панель мастера: расписание, клиенты, заработок.
        </p>
        <button
          type="button"
          onClick={() => unpairMut.mutate({ tenantId, masterId })}
          disabled={unpairMut.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/20 disabled:opacity-40"
        >
          {unpairMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
          Отвязать
        </button>
      </div>
    );
  }

  // State 2: pending code (just minted, or active one from earlier session).
  const linkToShow = generatedLink ?? (hasActiveCode && botUsername
    ? // We never expose the raw token after mint — if the user re-enters
      // a session with an active code we just tell them to re-generate.
      null
    : null);
  const expiresAt = generatedExpiresAt ?? activeCodeExpiresAt;

  if (linkToShow) {
    return (
      <div className="glass-card rounded-2xl p-4 space-y-3" data-testid="pair-tg-pending">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-brand-500" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Ссылка для привязки готова</h3>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Открой эту ссылку на телефоне с установленным Telegram. Привязка одноразовая, действует {expiresAt ? fmtExpiresIn(expiresAt) : "до конца недели"}.
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-2">
          <code className="flex-1 truncate text-[10px] text-slate-700 dark:text-slate-300">{linkToShow}</code>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(linkToShow);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* clipboard not granted — user can long-press to copy */
              }
            }}
            className="rounded-md bg-brand-500/10 px-2 py-1 text-[10px] font-medium text-brand-600 dark:text-brand-300 hover:bg-brand-500/20"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
        <a
          href={linkToShow}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600"
        >
          <Send className="h-3.5 w-3.5" />
          Открыть в Telegram
        </a>
      </div>
    );
  }

  // State 3: no pairing, no active code, bot is connected → CTA.
  return (
    <div className="glass-card rounded-2xl p-4 space-y-3" data-testid="pair-tg-cta">
      <div className="flex items-center gap-2">
        <Send className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Привязать Telegram</h3>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Привяжи свой Telegram — будешь получать уведомления о новых записях прямо в бот салона и сможешь работать в роли мастера: смотреть расписание, подтверждать записи, видеть клиентов.
      </p>
      {hasActiveCode && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          У тебя уже есть pending-ссылка (выдана раньше). Сгенерируй новую — старая перестанет действовать после успешной привязки.
        </p>
      )}
      <button
        type="button"
        onClick={() => mintMut.mutate({ tenantId, masterId })}
        disabled={mintMut.isPending}
        data-testid="pair-tg-mint"
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-40"
      >
        {mintMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        Сгенерировать ссылку
      </button>
      {mintMut.error && (
        <p className="text-[10px] text-red-500">{mintMut.error.message}</p>
      )}
    </div>
  );
}
