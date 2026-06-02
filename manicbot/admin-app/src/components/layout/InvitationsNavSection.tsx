"use client";

/**
 * Sidebar "Invitations" section — pending master invitations addressed to the
 * current user (api.webUsers.myPendingInvitations).
 *
 * Renders ONLY when there is at least one pending invitation, so the section
 * and its red count badge are a self-clearing signal: accept (or let expire)
 * the last invite and the whole section disappears. Each row links to the
 * accept page (/invitations/<id>); the notification bell surfaces the same
 * invites, this is the persistent in-rail mirror.
 *
 * Mirrors PinnedNavSection's structure (collapsed handling, header style,
 * NavLink-style active accent) so it visually rhymes with the rest of the rail.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { tNav } from "~/lib/nav/navLabels";

const ACTIVE_CLASSES =
  "bg-accent-500/10 dark:bg-accent-500/15 text-accent-700 dark:text-accent-400 font-semibold border-l-[3px] border-accent-500 dark:border-accent-400";
const INACTIVE_CLASSES =
  "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04] hover:text-slate-700 dark:hover:text-slate-200 border-l-[3px] border-transparent";

export function InvitationsNavSection({ collapsed = false }: { collapsed?: boolean }) {
  const { lang } = useLang();
  const pathname = usePathname();
  const invitations = api.webUsers.myPendingInvitations.useQuery(undefined, { staleTime: 60_000 });

  const items = invitations.data ?? [];
  // Self-clearing: no pending invites → no section at all.
  if (items.length === 0) return null;

  const count = items.length;

  if (collapsed) {
    // Collapsed rail: a single icon carrying a red count badge, linking to the
    // first pending invite.
    return (
      <div data-testid="invitations-nav-section">
        <Link
          href={`/invitations/${items[0]!.invitationId}`}
          data-testid="invitations-nav-collapsed"
          title={`${tNav("Invitations", lang)} (${count})`}
          className={`relative flex items-center justify-center rounded-xl py-2 border-l-0 ${INACTIVE_CLASSES}`}
        >
          <Inbox className="h-[18px] w-[18px] shrink-0 text-purple-500 dark:text-purple-400" />
          <span className="absolute -top-0.5 right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold ring-2 ring-white dark:ring-slate-900">
            {count}
          </span>
        </Link>
      </div>
    );
  }

  return (
    <div data-testid="invitations-nav-section">
      <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-600 inline-flex items-center gap-1.5">
        <Inbox size={10} /> {tNav("Invitations", lang)}
        <span className="ml-0.5 min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
          {count}
        </span>
      </p>
      <div className="space-y-0.5">
        {items.map((inv) => {
          const href = `/invitations/${inv.invitationId}`;
          const active = pathname === href;
          return (
            <Link
              key={inv.invitationId}
              href={href}
              data-testid="invitation-nav-item"
              data-invitation-id={inv.invitationId}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 ${active ? ACTIVE_CLASSES : INACTIVE_CLASSES}`}
              title={inv.salonName}
            >
              <Inbox className="h-[18px] w-[18px] shrink-0 text-purple-500 dark:text-purple-400" />
              <span className="text-[13px] truncate">{inv.salonName}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
