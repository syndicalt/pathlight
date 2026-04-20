"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchApi } from "../../lib/api";
import { formatDuration, formatTokens, formatTimestamp } from "../../lib/format";

interface CommitSummary {
  commit: string;
  branch: string | null;
  dirty: boolean | null;
  traceCount: number;
  avgDuration: number | null;
  avgTokens: number | null;
  avgCost: number | null;
  failed: number;
  firstSeen: number;
  lastSeen: number;
}

const REGRESSION_PCT = 25; // highlight when a metric regresses by > 25%

function delta(current: number | null, baseline: number | null): { pct: number; worse: boolean; better: boolean } | null {
  if (current === null || baseline === null || baseline === 0) return null;
  const pct = ((current - baseline) / baseline) * 100;
  return { pct, worse: pct > REGRESSION_PCT, better: pct < -REGRESSION_PCT };
}

export default function CommitsPage() {
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchApi<{ commits: CommitSummary[] }>("/v1/traces/commits?limit=30")
      .then((d) => setCommits(d.commits))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // API returns newest-first (ordered by max(createdAt) desc). For regression math
  // each row compares against the previous (older) row, which is index+1.
  const rows = useMemo(() => {
    return commits.map((c, i) => {
      const baseline = commits[i + 1] || null;
      return {
        current: c,
        baseline,
        durationDelta: baseline ? delta(c.avgDuration, baseline.avgDuration) : null,
        tokensDelta: baseline ? delta(c.avgTokens, baseline.avgTokens) : null,
        costDelta: baseline ? delta(c.avgCost, baseline.avgCost) : null,
      };
    });
  }, [commits]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-zinc-500 hover:text-zinc-300">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Commits</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Per-commit regression view — each row compares against the previous commit. A red delta means the metric got worse by more than {REGRESSION_PCT}%.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-zinc-500 py-8">Loading commits…</p>
      ) : error ? (
        <p className="text-red-400 text-sm py-8">{error}</p>
      ) : rows.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-12 text-center">
          <p className="text-zinc-400">No traces with git context yet.</p>
          <p className="text-sm text-zinc-600 mt-1">Upgrade the SDK — it auto-captures commit/branch on every trace.</p>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="grid grid-cols-[140px_1fr_auto_auto_auto_auto_auto] gap-4 px-5 py-2.5 border-b border-zinc-800 text-[10px] text-zinc-600 uppercase tracking-widest">
            <span>Commit</span>
            <span>Branch</span>
            <span className="text-right">Traces</span>
            <span className="text-right">Avg duration</span>
            <span className="text-right">Avg tokens</span>
            <span className="text-right">Avg cost</span>
            <span className="text-right">Last run</span>
          </div>
          <div className="divide-y divide-zinc-800/50">
            {rows.map(({ current, durationDelta, tokensDelta, costDelta }) => {
              const regression = durationDelta?.worse || tokensDelta?.worse || costDelta?.worse || current.failed > 0;
              return (
                <Link
                  key={`${current.commit}-${current.branch}-${current.dirty}`}
                  href={`/?commit=${current.commit.slice(0, 12)}`}
                  className={`grid grid-cols-[140px_1fr_auto_auto_auto_auto_auto] gap-4 px-5 py-3 items-center text-xs hover:bg-zinc-800/30 transition-colors ${regression ? "bg-red-950/10" : ""}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <code className="font-mono text-zinc-300">{current.commit.slice(0, 8)}</code>
                    {current.dirty && (
                      <span title="Uncommitted changes at run time" className="text-[9px] px-1 rounded bg-amber-900/30 text-amber-300 border border-amber-800/40">dirty</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-zinc-400 truncate">{current.branch || "—"}</span>
                    {current.failed > 0 && (
                      <span className="text-[9px] px-1 rounded bg-red-900/40 text-red-300 border border-red-800/40">{current.failed} failed</span>
                    )}
                  </div>
                  <span className="text-right text-zinc-400">{current.traceCount}</span>
                  <MetricCell value={formatDuration(current.avgDuration)} delta={durationDelta} />
                  <MetricCell value={formatTokens(current.avgTokens)} delta={tokensDelta} />
                  <MetricCell value={current.avgCost ? `$${current.avgCost.toFixed(4)}` : "—"} delta={costDelta} />
                  <span className="text-right text-zinc-500">{formatTimestamp(new Date(current.lastSeen).toISOString())}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCell({
  value,
  delta,
}: {
  value: string;
  delta: { pct: number; worse: boolean; better: boolean } | null;
}) {
  return (
    <div className="text-right">
      <span className="text-zinc-300 font-mono">{value}</span>
      {delta && Math.abs(delta.pct) >= 1 && (
        <span className={`ml-2 text-[10px] font-mono ${delta.worse ? "text-red-400" : delta.better ? "text-emerald-400" : "text-zinc-600"}`}>
          {delta.pct > 0 ? "+" : ""}{delta.pct.toFixed(0)}%
        </span>
      )}
    </div>
  );
}
