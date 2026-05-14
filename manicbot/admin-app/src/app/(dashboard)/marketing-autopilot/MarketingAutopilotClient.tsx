"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import {
  RefreshCw,
  PlayCircle,
  PauseCircle,
  Sparkles,
  Send,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Clock,
  ImageIcon,
  X,
} from "lucide-react";

type Status =
  | "pending"
  | "generating"
  | "ready"
  | "publishing"
  | "posted"
  | "failed"
  | "paused";

const STATUS_LABELS: Record<Status, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: "Pending", color: "bg-slate-700 text-slate-200", icon: Clock },
  generating: { label: "Generating", color: "bg-yellow-700 text-yellow-100", icon: Sparkles },
  ready: { label: "Ready", color: "bg-blue-700 text-blue-100", icon: CheckCircle2 },
  publishing: { label: "Publishing", color: "bg-purple-700 text-purple-100", icon: Send },
  posted: { label: "Posted", color: "bg-emerald-700 text-emerald-100", icon: CheckCircle2 },
  failed: { label: "Failed", color: "bg-red-700 text-red-100", icon: AlertCircle },
  paused: { label: "Paused", color: "bg-orange-700 text-orange-100", icon: PauseCircle },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_LABELS[status as Status] ?? {
    label: status,
    color: "bg-slate-700 text-slate-200",
    icon: Clock,
  };
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${meta.color}`}
    >
      <Icon size={12} />
      {meta.label}
    </span>
  );
}

function fmtTs(unix: number | null) {
  if (!unix) return "—";
  return new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export default function MarketingAutopilotClient() {
  const [statusFilter, setStatusFilter] = useState<Status | "">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const status = api.marketingAutopilot.getStatus.useQuery();
  const slots = api.marketingAutopilot.listSlots.useQuery({
    status: statusFilter || undefined,
    limit: 50,
    order: "asc",
  });
  const slotDetail = api.marketingAutopilot.getSlot.useQuery(
    { id: selectedId ?? "" },
    { enabled: !!selectedId },
  );

  const utils = api.useUtils();
  const invalidateAll = () => {
    void utils.marketingAutopilot.listSlots.invalidate();
    void utils.marketingAutopilot.getStatus.invalidate();
    if (selectedId) void utils.marketingAutopilot.getSlot.invalidate({ id: selectedId });
  };

  const pause = api.marketingAutopilot.pauseSlot.useMutation({ onSuccess: invalidateAll });
  const resume = api.marketingAutopilot.resumeSlot.useMutation({ onSuccess: invalidateAll });
  const regenerate = api.marketingAutopilot.regenerateSlot.useMutation({ onSuccess: invalidateAll });
  const publishNow = api.marketingAutopilot.publishOneManual.useMutation({ onSuccess: invalidateAll });
  const runTick = api.marketingAutopilot.runTickManual.useMutation({ onSuccess: invalidateAll });

  const counts = status.data?.counts ?? [];
  const autopilotEnabled = status.data?.autopilotEnabled ?? false;

  return (
    <Shell
      title="@manicbot_com IG Autopilot"
      subtitle="God Mode — content plan + manual controls"
    >
      <div className="space-y-6 p-4 md:p-6">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${
                autopilotEnabled
                  ? "bg-emerald-700 text-emerald-100"
                  : "bg-slate-700 text-slate-300"
              }`}
            >
              {autopilotEnabled ? (
                <>
                  <PlayCircle size={16} /> Autopilot ON
                </>
              ) : (
                <>
                  <PauseCircle size={16} /> Autopilot OFF
                </>
              )}
            </span>
            {counts.map((c) => (
              <span
                key={c.status}
                className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300"
              >
                <span className="font-medium">{c.n}</span>{" "}
                <span className="opacity-70">{c.status}</span>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => invalidateAll()}
              className="inline-flex items-center gap-1 rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
              disabled={slots.isFetching || status.isFetching}
            >
              <RefreshCw size={14} className={slots.isFetching ? "animate-spin" : ""} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => runTick.mutate()}
              className="inline-flex items-center gap-1 rounded bg-purple-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-600 disabled:opacity-50"
              disabled={runTick.isPending}
            >
              <Sparkles size={14} />
              {runTick.isPending ? "Running…" : "Run tick now"}
            </button>
          </div>
        </div>

        {runTick.error && (
          <div className="rounded border border-red-700 bg-red-900/30 p-3 text-sm text-red-100">
            Tick failed: {runTick.error.message}
          </div>
        )}
        {publishNow.error && (
          <div className="rounded border border-red-700 bg-red-900/30 p-3 text-sm text-red-100">
            Publish failed: {publishNow.error.message}
          </div>
        )}

        {/* Filter */}
        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-400">Filter:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter((e.target.value as Status) || "")}
            className="rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
          >
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([v, m]) => (
              <option key={v} value={v}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-900">
          <table className="min-w-full divide-y divide-slate-700 text-sm">
            <thead className="bg-slate-800">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-300">Scheduled (UTC)</th>
                <th className="px-3 py-2 text-left font-medium text-slate-300">Theme</th>
                <th className="px-3 py-2 text-left font-medium text-slate-300">Topic</th>
                <th className="px-3 py-2 text-left font-medium text-slate-300">Status</th>
                <th className="px-3 py-2 text-left font-medium text-slate-300">Assets</th>
                <th className="px-3 py-2 text-left font-medium text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {slots.isLoading && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              )}
              {!slots.isLoading && (slots.data?.rows ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    No slots match the filter.
                  </td>
                </tr>
              )}
              {(slots.data?.rows ?? []).map((row) => (
                <tr key={row.id} className="hover:bg-slate-800/50">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-300">
                    {fmtTs(row.scheduledAt)}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{row.theme}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-slate-200">{row.topic}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={row.status} />
                    {row.errorCount > 0 && (
                      <span className="ml-2 rounded bg-red-900/40 px-1.5 py-0.5 text-xs text-red-200">
                        err×{row.errorCount}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">
                    {row.captionPl ? "cap" : "—"} / {row.imageUrl ? "img" : "—"}
                    {row.metaPostId && (
                      <span className="ml-2 text-emerald-300">live</span>
                    )}
                  </td>
                  <td className="space-x-1 whitespace-nowrap px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setSelectedId(row.id)}
                      className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
                    >
                      View
                    </button>
                    {row.status !== "paused" && row.status !== "posted" && (
                      <button
                        type="button"
                        onClick={() => pause.mutate({ id: row.id })}
                        className="rounded border border-orange-700 px-2 py-1 text-xs text-orange-200 hover:bg-orange-900/30"
                        disabled={pause.isPending}
                      >
                        Pause
                      </button>
                    )}
                    {row.status === "paused" && (
                      <button
                        type="button"
                        onClick={() => resume.mutate({ id: row.id })}
                        className="rounded border border-emerald-700 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-900/30"
                        disabled={resume.isPending}
                      >
                        Resume
                      </button>
                    )}
                    {(row.status === "failed" || row.status === "ready") && (
                      <button
                        type="button"
                        onClick={() =>
                          regenerate.mutate({ id: row.id, clearCaption: true, clearImage: true })
                        }
                        className="rounded border border-purple-700 px-2 py-1 text-xs text-purple-200 hover:bg-purple-900/30"
                        disabled={regenerate.isPending}
                      >
                        Regen
                      </button>
                    )}
                    {row.status !== "posted" && (
                      <button
                        type="button"
                        onClick={() => publishNow.mutate({ id: row.id })}
                        className="rounded border border-blue-700 px-2 py-1 text-xs text-blue-200 hover:bg-blue-900/30"
                        disabled={publishNow.isPending}
                        title="Manually advance this slot one step in the state machine"
                      >
                        Step
                      </button>
                    )}
                    {row.permalink && (
                      <a
                        href={row.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 rounded border border-emerald-700 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-900/30"
                      >
                        IG <ExternalLink size={10} />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selectedId && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-100">
                  Slot {selectedId}
                </h2>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="rounded p-1 text-slate-400 hover:bg-slate-800"
                >
                  <X size={18} />
                </button>
              </div>
              {slotDetail.isLoading && (
                <div className="text-slate-400">Loading…</div>
              )}
              {slotDetail.data && (
                <div className="space-y-4 text-sm text-slate-200">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-slate-400">Scheduled:</span>{" "}
                      {fmtTs(slotDetail.data.scheduledAt)}
                    </div>
                    <div>
                      <span className="text-slate-400">Status:</span>{" "}
                      <StatusBadge status={slotDetail.data.status} />
                    </div>
                    <div>
                      <span className="text-slate-400">Theme:</span>{" "}
                      {slotDetail.data.theme}
                    </div>
                    <div>
                      <span className="text-slate-400">Topic:</span>{" "}
                      {slotDetail.data.topic}
                    </div>
                    {slotDetail.data.errorMsg && (
                      <div className="col-span-2 text-red-300">
                        Last error: {slotDetail.data.errorMsg}
                      </div>
                    )}
                  </div>
                  {slotDetail.data.headlinePl && (
                    <div>
                      <div className="text-xs text-slate-400">Headline</div>
                      <div className="font-medium">{slotDetail.data.headlinePl}</div>
                    </div>
                  )}
                  {slotDetail.data.captionPl && (
                    <div>
                      <div className="text-xs text-slate-400">Caption</div>
                      <pre className="whitespace-pre-wrap rounded bg-slate-950 p-2 text-xs text-slate-200">
                        {slotDetail.data.captionPl}
                      </pre>
                    </div>
                  )}
                  {slotDetail.data.hashtags?.length > 0 && (
                    <div>
                      <div className="text-xs text-slate-400">Hashtags</div>
                      <div className="text-xs text-slate-300">
                        {slotDetail.data.hashtags.join(" ")}
                      </div>
                    </div>
                  )}
                  {slotDetail.data.imageUrl && (
                    <div>
                      <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">
                        <ImageIcon size={12} /> Image
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={slotDetail.data.imageUrl}
                        alt={slotDetail.data.headlinePl ?? "post"}
                        className="max-h-96 rounded border border-slate-700"
                      />
                      <a
                        href={slotDetail.data.imageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-xs text-blue-300 hover:underline"
                      >
                        Open R2 URL
                      </a>
                    </div>
                  )}
                  {slotDetail.data.publishQueue && (
                    <div className="rounded bg-slate-950 p-2 text-xs text-slate-300">
                      <div className="text-slate-400">Publish queue</div>
                      <div>
                        container: {slotDetail.data.publishQueue.metaContainerId ?? "—"}
                      </div>
                      <div>status: {slotDetail.data.publishQueue.status}</div>
                      <div>attempts: {slotDetail.data.publishQueue.attempts}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
