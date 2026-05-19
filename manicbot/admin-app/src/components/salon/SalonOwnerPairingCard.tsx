"use client";

/**
 * Owner-side "Привязать свой Telegram" card on the Salon dashboard
 * Channels → Telegram sub-tab.
 *
 * Symmetric to `master/MasterTelegramPairingCard.tsx` but keyed on
 * the tenant_owner's web_users row. Renders three states:
 *
 *   1. Already paired   → green pill + "Отвязать" button.
 *   2. Pending code     → blue card with copyable deep-link.
 *   3. Not paired       → CTA "Сгенерировать ссылку".
 *
 * Self-hides when the salon has no active bot AND the owner is not
 * paired — the same friendly-placeholder shape as the master card.
 */

import { useState } from "react";
import { Send, Loader2, Copy, Check, Unlink, ShieldCheck } from "lucide-react";
import { api } from "~/trpc/react";

interface Props {
  tenantId: string;
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

export function SalonOwnerPairingCard({ tenantId }: Props) {
  const utils = api.useUtils();
  const stateQ = api.ownerPairing.getMyPairingState.useQuery(
    { tenantId },
    { refetchInterval: 30_000 },
  );
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [generatedExpiresAt, setGeneratedExpiresAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const mintMut = api.ownerPairing.requestPairingCode.useMutation({
    onSuccess: async (res) => {
      setGeneratedLink(res.deepLink);
      setGeneratedExpiresAt(res.expiresAt);
      await utils.ownerPairing.getMyPairingState.invalidate({ tenantId });
    },
  });
  const unpairMut = api.ownerPairing.unpair.useMutation({
    onSuccess: async () => {
      setGeneratedLink(null);
      setGeneratedExpiresAt(null);
      await utils.ownerPairing.getMyPairingState.invalidate({ tenantId });
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
  const { telegramChatId, hasActiveCode, activeCodeExpiresAt, botUsername } = stateQ.data;

  // Salon hasn't connected a bot yet and the owner has nothing to
  // unbind — hide the card. Once a bot is connected it returns and
  // shows the mint CTA.
  if (!botUsername && telegramChatId === null) {
    return null;
  }

  // State 1: already paired.
  if (telegramChatId !== null) {
    return (
      <div className="glass-card rounded-2xl p-4 space-y-3" data-testid="owner-pair-tg-bound">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Ваш Telegram привязан как владелец
            </h3>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
            <Check className="h-3 w-3" />
            ID: {telegramChatId}
          </span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          В боте салона у вас откроется админ-панель: записи, мастера, услуги, настройки. Все уведомления о новых записях будут приходить в Telegram.
        </p>
        <button
          type="button"
          onClick={() => unpairMut.mutate({ tenantId })}
          disabled={unpairMut.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/20 disabled:opacity-40"
        >
          {unpairMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
          Отвязать
        </button>
      </div>
    );
  }

  // State 2: pending code (just minted in this session, or restored
  // from server). The server never echoes the raw token after mint —
  // restored pending state shows the "stale link" warning instead.
  const linkToShow = generatedLink;
  const expiresAt = generatedExpiresAt ?? activeCodeExpiresAt;

  if (linkToShow) {
    return (
      <div className="glass-card rounded-2xl p-4 space-y-3" data-testid="owner-pair-tg-pending">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-brand-500" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Ссылка для привязки готова</h3>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Откройте ссылку на телефоне с Telegram — бот сразу узнает вас как владельца. Привязка одноразовая, действует {expiresAt ? fmtExpiresIn(expiresAt) : "до конца недели"}.
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
                /* clipboard not granted — long-press to copy */
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

  // State 3: no pairing, no link in session, bot is connected → CTA.
  return (
    <div className="glass-card rounded-2xl p-4 space-y-3" data-testid="owner-pair-tg-cta">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-brand-500" />
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
          Привязать свой Telegram как владельца
        </h3>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        В боте салона у вас откроется админ-панель: записи, мастера, настройки. Без привязки бот не узнает, что вы — владелец, и встретит вас как обычного клиента.
      </p>
      {hasActiveCode && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          У вас уже есть pending-ссылка (выдана раньше). Сгенерируйте новую — после успешной привязки старая перестанет работать.
        </p>
      )}
      <button
        type="button"
        onClick={() => mintMut.mutate({ tenantId })}
        disabled={mintMut.isPending}
        data-testid="owner-pair-tg-mint"
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-40"
      >
        {mintMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        Сгенерировать ссылку
      </button>
    </div>
  );
}
