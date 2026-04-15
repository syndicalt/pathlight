"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchApi } from "../lib/api";
import { formatDuration, formatTokens, formatTimestamp } from "../lib/format";

interface Trace {
  id: string;
  name: string;
  status: "running" | "completed" | "failed" | "cancelled";
  input: string | null;
  totalDurationMs: number | null;
  totalTokens: number | null;
  totalCost: number | null;
  tags: string | null;
  createdAt: string;
}

const STATUS_STYLES: Record<string, { dot: string; text: string }> = {
  running: { dot: "bg-blue-500 animate-pulse", text: "text-blue-400" },
  completed: { dot: "bg-emerald-500", text: "text-emerald-400" },
  failed: { dot: "bg-red-500", text: "text-red-400" },
  cancelled: { dot: "bg-zinc-500", text: "text-zinc-400" },
};

export default function TracesPage() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetchApi<{ traces: Trace[]; total: number }>("/v1/traces?limit=50")
      .then((data) => {
        setTraces(data.traces);
        setTotal(data.total);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter
    ? traces.filter((t) =>
        t.name.toLowerCase().includes(filter.toLowerCase()) ||
        t.status.includes(filter.toLowerCase())
      )
    : traces;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Traces</h1>
          <p className="text-sm text-zinc-500 mt-1">{total} total trace{total !== 1 ? "s" : ""}</p>
        </div>
      </div>

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by name or status..."
        className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
      />

      {loading ? (
        <p className="text-zinc-500 py-8">Loading traces...</p>
      ) : filtered.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-12 text-center">
          <p className="text-zinc-400">No traces yet.</p>
          <p className="text-sm text-zinc-600 mt-1">Instrument your agent with the TraceLens SDK to start capturing traces.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((trace) => {
            const style = STATUS_STYLES[trace.status] || STATUS_STYLES.cancelled;
            const tags: string[] = trace.tags ? JSON.parse(trace.tags) : [];
            let inputPreview = "";
            try {
              const parsed = JSON.parse(trace.input || "{}");
              inputPreview = typeof parsed === "string" ? parsed : Object.values(parsed).join(" ").slice(0, 100);
            } catch {
              inputPreview = (trace.input || "").slice(0, 100);
            }

            return (
              <Link
                key={trace.id}
                href={`/traces/${trace.id}`}
                className="block bg-zinc-900 border border-zinc-800 rounded-lg px-5 py-4 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                    <span className="font-medium text-sm">{trace.name}</span>
                    <span className={`text-xs ${style.text}`}>{trace.status}</span>
                    {tags.map((tag) => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700/50">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-6 shrink-0 text-xs text-zinc-500">
                    <span>{formatDuration(trace.totalDurationMs)}</span>
                    {trace.totalTokens && <span>{formatTokens(trace.totalTokens)} tok</span>}
                    <span>{formatTimestamp(trace.createdAt)}</span>
                  </div>
                </div>
                {inputPreview && (
                  <p className="text-xs text-zinc-600 mt-2 truncate ml-5">{inputPreview}</p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
