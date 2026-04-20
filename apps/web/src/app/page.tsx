"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchApi, COLLECTOR_URL } from "../lib/api";
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
  reviewedAt: string | null;
  gitCommit: string | null;
  gitBranch: string | null;
  gitDirty: boolean | null;
  issues: string[];
  hasIssues: boolean;
}

const STATUS_STYLES: Record<string, { dot: string; text: string }> = {
  running: { dot: "bg-blue-500 animate-pulse", text: "text-blue-400" },
  completed: { dot: "bg-emerald-500", text: "text-emerald-400" },
  failed: { dot: "bg-red-500", text: "text-red-400" },
  cancelled: { dot: "bg-zinc-500", text: "text-zinc-400" },
};

export default function TracesPage() {
  return (
    <Suspense fallback={<div className="max-w-6xl mx-auto px-6 py-8 text-zinc-500">Loading…</div>}>
      <TracesPageInner />
    </Suspense>
  );
}

function TracesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const commitFilter = searchParams.get("commit");
  const [traces, setTraces] = useState<Trace[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const compareSelected = () => {
    if (selected.length === 2) {
      router.push(`/traces/compare?a=${selected[0]}&b=${selected[1]}`);
    }
  };

  useEffect(() => {
    fetchApi<{ traces: Trace[]; total: number }>("/v1/traces?limit=50")
      .then((data) => {
        setTraces(data.traces);
        setTotal(data.total);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const source = new EventSource(`${COLLECTOR_URL}/v1/traces/stream`);

    const onCreated = (e: MessageEvent) => {
      const trace = JSON.parse(e.data) as Trace;
      setTraces((prev) => (prev.some((t) => t.id === trace.id) ? prev : [trace, ...prev]));
      setTotal((prev) => prev + 1);
    };

    const onUpdated = (e: MessageEvent) => {
      const trace = JSON.parse(e.data) as Trace;
      setTraces((prev) =>
        prev.map((t) =>
          t.id === trace.id
            ? {
                ...t,
                ...trace,
                // Stream events carry stub issue data; keep the richer enrichment
                // from the initial list fetch unless it becomes non-empty later.
                issues: trace.issues.length ? trace.issues : t.issues,
                hasIssues: trace.hasIssues || t.hasIssues,
              }
            : t,
        ),
      );
    };

    source.addEventListener("trace.created", onCreated);
    source.addEventListener("trace.updated", onUpdated);

    return () => {
      source.removeEventListener("trace.created", onCreated);
      source.removeEventListener("trace.updated", onUpdated);
      source.close();
    };
  }, []);

  const filtered = traces
    .filter((t) => (commitFilter ? (t.gitCommit || "").startsWith(commitFilter) : true))
    .filter((t) =>
      filter
        ? t.name.toLowerCase().includes(filter.toLowerCase()) ||
          t.status.includes(filter.toLowerCase())
        : true,
    );

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Traces</h1>
          <p className="text-sm text-zinc-500 mt-1">{total} total trace{total !== 1 ? "s" : ""}</p>
        </div>
        <Link
          href="/commits"
          className="text-xs px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100 transition-colors"
        >
          Commits →
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or status..."
          className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
        />
        {commitFilter && (
          <div className="flex items-center gap-2 text-xs bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
            <span className="text-zinc-500">commit</span>
            <code className="font-mono text-zinc-300">{commitFilter.slice(0, 8)}</code>
            <button
              onClick={() => router.push("/")}
              className="text-zinc-500 hover:text-zinc-300"
              aria-label="Clear commit filter"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-zinc-500 py-8">Loading traces...</p>
      ) : filtered.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-12 text-center">
          <p className="text-zinc-400">No traces yet.</p>
          <p className="text-sm text-zinc-600 mt-1">Instrument your agent with the Pathlight SDK to start capturing traces.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((trace) => {
            const style = STATUS_STYLES[trace.status] || STATUS_STYLES.cancelled;
            const tags: string[] = trace.tags ? JSON.parse(trace.tags) : [];
            let inputPreview = "";
            try {
              const parsed = JSON.parse(trace.input || "{}");
              inputPreview =
                typeof parsed === "string"
                  ? parsed
                  : Object.values(parsed)
                      .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
                      .join(" ")
                      .slice(0, 100);
            } catch {
              inputPreview = (trace.input || "").slice(0, 100);
            }

            const unreviewed = !trace.reviewedAt;
            const isSelected = selected.includes(trace.id);
            return (
              <Link
                key={trace.id}
                href={`/traces/${trace.id}`}
                className={`group block bg-zinc-900 border border-zinc-800 border-l-2 rounded-lg px-5 py-4 hover:border-zinc-700 transition-colors ${unreviewed ? "border-l-sky-500/40" : "border-l-zinc-800"} ${isSelected ? "ring-1 ring-blue-500/60" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleSelect(trace.id);
                      }}
                      aria-label={isSelected ? "Deselect for compare" : "Select for compare"}
                      className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center transition ${
                        isSelected
                          ? "bg-blue-500 border-blue-400 text-white"
                          : "border-zinc-700 hover:border-zinc-500 opacity-0 group-hover:opacity-100"
                      } ${selected.length > 0 ? "opacity-100" : ""}`}
                    >
                      {isSelected && (
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                    <div className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                    <span className="font-medium text-sm">{trace.name}</span>
                    <span className={`text-xs ${style.text}`}>{trace.status}</span>
                    {trace.hasIssues && (
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-300 border border-amber-800/50">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                        </svg>
                        Issues detected
                      </span>
                    )}
                    {tags.map((tag) => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700/50">
                        {tag}
                      </span>
                    ))}
                    {trace.gitCommit && (
                      <span
                        title={`${trace.gitBranch || "?"} @ ${trace.gitCommit}${trace.gitDirty ? " (dirty)" : ""}`}
                        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                          trace.gitDirty
                            ? "bg-amber-900/20 text-amber-300 border-amber-800/40"
                            : "bg-zinc-800 text-zinc-400 border-zinc-700/50"
                        }`}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <circle cx="6" cy="6" r="2" />
                          <circle cx="18" cy="6" r="2" />
                          <circle cx="18" cy="18" r="2" />
                          <path strokeLinecap="round" d="M8 6h6a4 4 0 014 4v8" />
                        </svg>
                        {trace.gitCommit.slice(0, 7)}
                        {trace.gitDirty && <span className="opacity-70">*</span>}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-6 shrink-0 text-xs text-zinc-500">
                    <span>{formatDuration(trace.totalDurationMs)}</span>
                    {trace.totalTokens && <span>{formatTokens(trace.totalTokens)} tok</span>}
                    <span>{formatTimestamp(trace.createdAt)}</span>
                  </div>
                </div>
                {inputPreview && (
                  <p className="text-xs text-zinc-600 mt-2 truncate ml-11">{inputPreview}</p>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {selected.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-900 border border-zinc-700 rounded-full shadow-2xl px-4 py-2 flex items-center gap-3 z-50">
          <span className="text-xs text-zinc-400">
            {selected.length} selected {selected.length === 2 ? "" : "— pick one more to compare"}
          </span>
          <button
            onClick={() => setSelected([])}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            Clear
          </button>
          <button
            onClick={compareSelected}
            disabled={selected.length !== 2}
            className="text-xs px-3 py-1.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed transition-colors"
          >
            Compare →
          </button>
        </div>
      )}
    </div>
  );
}
