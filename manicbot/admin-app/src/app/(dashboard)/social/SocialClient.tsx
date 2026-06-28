"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { Select } from "~/components/ui/Select";
import { CheckCircle2, X, MessageSquare, AlertTriangle, Send, RefreshCw } from "lucide-react";

/**
 * God Mode @manicbot_com social automation (migration 0127). system_admin-only,
 * intentionally single-language (English) like the marketing-autopilot surface.
 * D1-only actions — the Worker (autopilot + phaseSocialCommentReply) does the
 * actual Graph API posting from the rows transitioned here.
 */

const COMMENT_STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "drafted", label: "Drafted" },
  { value: "replied", label: "Replied" },
  { value: "escalated", label: "Escalated" },
  { value: "skipped", label: "Skipped" },
  { value: "failed", label: "Failed" },
];

function fmtTs(unix: number | null | undefined) {
  if (!unix) return "—";
  return new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export default function SocialClient() {
  const [status, setStatus] = useState("new");
  const utils = api.useUtils();

  const counts = api.social.counts.useQuery();
  const inbox = api.social.inbox.useQuery({ status: status as never, limit: 50 });
  const pending = api.social.pendingPosts.useQuery({ limit: 50 });

  const refetchAll = () => {
    void utils.social.counts.invalidate();
    void utils.social.inbox.invalidate();
    void utils.social.pendingPosts.invalidate();
  };

  const approvePost = api.social.approvePost.useMutation({ onSuccess: refetchAll });
  const commentDecision = api.social.commentDecision.useMutation({ onSuccess: refetchAll });

  return (
    <Shell title="Social automation">
      <div className="space-y-6 p-4">
        {/* Counts */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={refetchAll}
            className="inline-flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-xs text-slate-100 hover:bg-slate-600"
          >
            <RefreshCw size={12} /> Refresh
          </button>
          <span className="rounded bg-blue-700 px-2 py-1 text-xs text-blue-100">
            Posts awaiting approval: {counts.data?.pendingPosts ?? "…"}
          </span>
          {counts.data?.comments.map((c) => (
            <span key={c.status} className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-200">
              {c.status}: {c.n}
            </span>
          ))}
        </div>

        {/* Pending posts (Telegram approval gate) */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-200">Posts awaiting approval</h2>
          <div className="space-y-2">
            {pending.data?.rows.length === 0 && (
              <p className="text-xs text-slate-500">Nothing waiting.</p>
            )}
            {pending.data?.rows.map((p) => (
              <div key={p.id} className="rounded border border-slate-700 bg-slate-800 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-400">{p.theme} · {fmtTs(p.scheduledAt)}</p>
                    <p className="truncate text-sm font-medium text-slate-100">{p.headlinePl ?? p.topic}</p>
                    <p className="mt-1 line-clamp-3 text-xs text-slate-300">{p.captionPl}</p>
                  </div>
                  {p.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    disabled={approvePost.isPending}
                    onClick={() => approvePost.mutate({ id: p.id, decision: "approve" })}
                    className="inline-flex items-center gap-1 rounded bg-emerald-700 px-2 py-1 text-xs text-emerald-100 hover:bg-emerald-600 disabled:opacity-50"
                  >
                    <CheckCircle2 size={12} /> Approve
                  </button>
                  <button
                    disabled={approvePost.isPending}
                    onClick={() => approvePost.mutate({ id: p.id, decision: "skip" })}
                    className="inline-flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-50"
                  >
                    <X size={12} /> Skip
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Comment inbox */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-200">Comment inbox</h2>
            <Select
              value={status}
              onChange={(v) => setStatus(v)}
              options={COMMENT_STATUS_OPTIONS}
              testIdPrefix="social-status"
              aria-label="Filter comments by status"
              className="w-40"
            />
          </div>
          <div className="space-y-2">
            {inbox.data?.rows.length === 0 && <p className="text-xs text-slate-500">No comments.</p>}
            {inbox.data?.rows.map((c) => (
              <div key={c.id} className="rounded border border-slate-700 bg-slate-800 p-3">
                <p className="text-xs text-slate-400">
                  {c.channelType} · @{c.fromUsername ?? "user"} · {fmtTs(c.createdAt)}
                  {c.classification ? ` · ${c.classification}` : ""}
                </p>
                <p className="text-sm text-slate-100">{c.text}</p>
                {c.replyText && <p className="mt-1 text-xs text-emerald-300">↳ {c.replyText}</p>}
                {c.status === "new" && (
                  <div className="mt-2 flex gap-2">
                    <button
                      disabled={commentDecision.isPending}
                      onClick={() => {
                        const reply = window.prompt("Reply text:");
                        if (reply?.trim()) {
                          commentDecision.mutate({ commentId: c.commentId, action: "draft", replyText: reply.trim() });
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded bg-blue-700 px-2 py-1 text-xs text-blue-100 hover:bg-blue-600 disabled:opacity-50"
                    >
                      <Send size={12} /> Draft reply
                    </button>
                    <button
                      disabled={commentDecision.isPending}
                      onClick={() => commentDecision.mutate({ commentId: c.commentId, action: "escalate", classification: "complaint" })}
                      className="inline-flex items-center gap-1 rounded bg-orange-700 px-2 py-1 text-xs text-orange-100 hover:bg-orange-600 disabled:opacity-50"
                    >
                      <AlertTriangle size={12} /> Escalate
                    </button>
                    <button
                      disabled={commentDecision.isPending}
                      onClick={() => commentDecision.mutate({ commentId: c.commentId, action: "skip" })}
                      className="inline-flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-50"
                    >
                      <MessageSquare size={12} /> Skip
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </Shell>
  );
}
