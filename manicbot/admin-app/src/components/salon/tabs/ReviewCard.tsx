"use client";

import { useState } from "react";
import { Star, Eye, EyeOff, Reply, Trash2 } from "lucide-react";
import { api } from "~/trpc/react";

export function ReviewCard({ rev, tenantId }: { rev: any; tenantId: string }) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState(rev.replyText ?? "");
  const utils = api.useUtils();

  const updateStatus = api.reviews.updateStatus.useMutation({
    onSuccess: () => utils.reviews.getForSalon.invalidate(),
  });
  const addReply = api.reviews.addReply.useMutation({
    onSuccess: () => { utils.reviews.getForSalon.invalidate(); setReplyOpen(false); },
  });
  const deleteReply = api.reviews.deleteReply.useMutation({
    onSuccess: () => utils.reviews.getForSalon.invalidate(),
  });

  const STATUS_LABELS: Record<string, string> = { active: "Active", hidden: "Hidden", featured: "Featured" };
  const STATUS_COLORS: Record<string, string> = {
    active: "bg-emerald-500/20 text-emerald-500",
    hidden: "bg-slate-500/20 text-slate-400",
    featured: "bg-amber-500/20 text-amber-500",
  };

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-brand-500/10 flex items-center justify-center text-brand-400 text-xs font-bold shrink-0">
          {(rev.userName ?? "?").charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-900 dark:text-white">{rev.userName ?? `User #${rev.chatId}`}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${STATUS_COLORS[rev.status] ?? ""}`}>
              {STATUS_LABELS[rev.status] ?? rev.status}
            </span>
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            {[1,2,3,4,5].map(s => (
              <Star key={s} className={`w-3 h-3 ${s <= rev.rating ? "text-amber-400 fill-amber-400" : "text-slate-300 dark:text-slate-600"}`} />
            ))}
            <span className="text-[10px] text-slate-500 ml-1">
              {new Date(rev.createdAt * 1000).toLocaleDateString()}
            </span>
          </div>
          {rev.text && <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 line-clamp-3">{rev.text}</p>}
          {rev.photos?.length > 0 && (
            <div className="flex gap-1 mt-2">
              {rev.photos.map((p: string, i: number) => (
                <div key={i} className="w-12 h-12 rounded-lg bg-slate-200 dark:bg-slate-700 text-[9px] text-slate-400 flex items-center justify-center">
                  img
                </div>
              ))}
            </div>
          )}
          {rev.replyText && (
            <div className="mt-2 p-2 rounded-lg bg-slate-100 dark:bg-slate-800/60 border-l-2 border-brand-400">
              <p className="text-[10px] text-brand-400 font-medium mb-0.5">Salon reply</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">{rev.replyText}</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-200 dark:border-white/5">
        <button
          onClick={() => updateStatus.mutate({ tenantId, reviewId: rev.id, status: rev.status === "hidden" ? "active" : "hidden" })}
          className="text-[10px] px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          {rev.status === "hidden" ? <><Eye className="w-3 h-3 inline mr-1" />Show</> : <><EyeOff className="w-3 h-3 inline mr-1" />Hide</>}
        </button>
        <button
          onClick={() => updateStatus.mutate({ tenantId, reviewId: rev.id, status: rev.status === "featured" ? "active" : "featured" })}
          className="text-[10px] px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          <Star className={`w-3 h-3 inline mr-1 ${rev.status === "featured" ? "fill-amber-400 text-amber-400" : ""}`} />
          {rev.status === "featured" ? "Unfeature" : "Feature"}
        </button>
        {!rev.replyText ? (
          <button
            onClick={() => setReplyOpen(!replyOpen)}
            className="text-[10px] px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            <Reply className="w-3 h-3 inline mr-1" />Reply
          </button>
        ) : (
          <button
            onClick={() => deleteReply.mutate({ tenantId, reviewId: rev.id })}
            className="text-[10px] px-2 py-1 rounded-lg bg-red-500/10 text-red-400"
          >
            <Trash2 className="w-3 h-3 inline mr-1" />Delete reply
          </button>
        )}
      </div>

      {replyOpen && (
        <div className="mt-2 flex gap-2">
          <input
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            placeholder="Write your reply..."
            className="flex-1 text-xs px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:border-brand-500"
          />
          <button
            onClick={() => addReply.mutate({ tenantId, reviewId: rev.id, text: replyText })}
            disabled={!replyText.trim() || addReply.isPending}
            className="px-3 py-2 rounded-lg bg-brand-500 text-white text-xs font-medium disabled:opacity-50"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
