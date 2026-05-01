"use client";

import { Suspense, useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { fetchApi } from "../../../lib/api";
import { formatDuration, formatTokens } from "../../../lib/format";
import { diffLines, prettyJson, type DiffLine } from "../../../lib/diff";

interface Trace {
  id: string;
  name: string;
  status: string;
  input: string | null;
  output: string | null;
  error: string | null;
  totalDurationMs: number | null;
  totalTokens: number | null;
  totalCost: number | null;
  createdAt: string;
}

interface Span {
  id: string;
  name: string;
  type: string;
  status: string;
  input: string | null;
  output: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  durationMs: number | null;
  startedAt: string;
}

type TraceBundle = { trace: Trace; spans: Span[] };

const STATUS_DOT: Record<string, string> = {
  running: "bg-blue-500 animate-pulse",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  cancelled: "bg-zinc-500",
};

function delta(a: number | null, b: number | null): { text: string; className: string } | null {
  if (a === null || b === null || a === 0) return null;
  const diff = b - a;
  const pct = (diff / a) * 100;
  const sign = diff > 0 ? "+" : "";
  const className = Math.abs(pct) < 1 ? "text-zinc-500" : diff > 0 ? "text-amber-400" : "text-emerald-400";
  return { text: `${sign}${pct.toFixed(0)}%`, className };
}

function alignSpans(left: Span[], right: Span[]): Array<{ a: Span | null; b: Span | null }> {
  // Align by position in a name-keyed LCS. Spans sharing the same name at the same
  // sequential rank are paired; unpaired spans show as adds/removes.
  const leftNames = left.map((s) => s.name);
  const rightNames = right.map((s) => s.name);
  const m = leftNames.length;
  const n = rightNames.length;

  const table: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      table[i][j] = leftNames[i - 1] === rightNames[j - 1]
        ? table[i - 1][j - 1] + 1
        : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }

  const pairs: Array<{ a: Span | null; b: Span | null }> = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (leftNames[i - 1] === rightNames[j - 1]) {
      pairs.unshift({ a: left[i - 1], b: right[j - 1] });
      i--;
      j--;
    } else if (table[i - 1][j] >= table[i][j - 1]) {
      pairs.unshift({ a: left[i - 1], b: null });
      i--;
    } else {
      pairs.unshift({ a: null, b: right[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    pairs.unshift({ a: left[i - 1], b: null });
    i--;
  }
  while (j > 0) {
    pairs.unshift({ a: null, b: right[j - 1] });
    j--;
  }
  return pairs;
}

function JsonDiff({ left, right }: { left: string | null; right: string | null }) {
  const diff = useMemo(() => diffLines(prettyJson(left), prettyJson(right)), [left, right]);
  if (diff.length === 0 || (diff.length === 1 && diff[0].kind === "eq" && !diff[0].left)) {
    return <p className="text-xs text-zinc-600 italic px-3 py-2">empty</p>;
  }

  const hasDiff = diff.some((d) => d.kind !== "eq");
  if (!hasDiff) {
    return (
      <pre className="text-xs text-zinc-400 font-mono px-3 py-2 whitespace-pre-wrap max-h-72 overflow-y-auto">
        {diff.map((d, i) => (d.left ?? d.right ?? "") + (i < diff.length - 1 ? "\n" : "")).join("")}
      </pre>
    );
  }

  return (
    <div className="text-xs font-mono max-h-72 overflow-y-auto">
      {diff.map((d, i) => (
        <DiffRow key={i} line={d} />
      ))}
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  if (line.kind === "eq") {
    return <div className="px-3 text-zinc-500 whitespace-pre-wrap">{line.left || "\u00A0"}</div>;
  }
  if (line.kind === "del") {
    return <div className="px-3 bg-red-950/40 text-red-300 whitespace-pre-wrap">- {line.left || "\u00A0"}</div>;
  }
  return <div className="px-3 bg-emerald-950/40 text-emerald-300 whitespace-pre-wrap">+ {line.right || "\u00A0"}</div>;
}

export default function CompareTracesPage() {
  return (
    <Suspense fallback={<div className="max-w-7xl mx-auto px-6 py-8 text-zinc-500">Loading…</div>}>
      <CompareTracesInner />
    </Suspense>
  );
}

function CompareTracesInner() {
  const params = useSearchParams();
  const aId = params.get("a");
  const bId = params.get("b");

  const [a, setA] = useState<TraceBundle | null>(null);
  const [b, setB] = useState<TraceBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!aId || !bId) {
      setError("Missing trace ids (need ?a=...&b=...)");
      setLoading(false);
      return;
    }
    Promise.all([
      fetchApi<TraceBundle>(`/v1/traces/${aId}`),
      fetchApi<TraceBundle>(`/v1/traces/${bId}`),
    ])
      .then(([ra, rb]) => {
        setA(ra);
        setB(rb);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [aId, bId]);

  const pairs = useMemo(() => {
    if (!a || !b) return [];
    return alignSpans(a.spans, b.spans);
  }, [a, b]);

  if (loading) {
    return <div className="max-w-7xl mx-auto px-6 py-8 text-zinc-500">Loading comparison…</div>;
  }
  if (error || !a || !b) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <p className="text-red-400 text-sm">{error || "Failed to load traces"}</p>
        <Link href="/" className="text-xs text-blue-400 hover:underline mt-2 inline-block">← Back to traces</Link>
      </div>
    );
  }

  const durationDelta = delta(a.trace.totalDurationMs, b.trace.totalDurationMs);
  const tokenDelta = delta(a.trace.totalTokens, b.trace.totalTokens);
  const costDelta = delta(a.trace.totalCost, b.trace.totalCost);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-zinc-500 hover:text-zinc-300">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <h1 className="text-xl font-bold">Compare traces</h1>
      </div>

      {/* Trace headers */}
      <div className="grid grid-cols-2 gap-4">
        {[a, b].map((side, idx) => (
          <div key={side.trace.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${idx === 0 ? "bg-red-900/40 text-red-300" : "bg-emerald-900/40 text-emerald-300"}`}>
                {idx === 0 ? "A" : "B"}
              </span>
              <div className={`w-2 h-2 rounded-full ${STATUS_DOT[side.trace.status] || "bg-zinc-500"}`} />
              <Link href={`/traces/${side.trace.id}`} className="font-semibold hover:underline truncate">
                {side.trace.name}
              </Link>
              <span className="text-xs text-zinc-500 ml-auto font-mono">{side.trace.id.slice(0, 10)}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <Metric label="Duration" value={formatDuration(side.trace.totalDurationMs)} />
              <Metric label="Tokens" value={formatTokens(side.trace.totalTokens)} />
              <Metric label="Spans" value={String(side.spans.length)} />
            </div>
          </div>
        ))}
      </div>

      {/* Delta summary */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-5 py-3 flex items-center gap-8 text-sm">
        <span className="text-xs text-zinc-500">B vs A:</span>
        {durationDelta && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-600 uppercase">Duration</span>
            <span className={`font-semibold ${durationDelta.className}`}>{durationDelta.text}</span>
          </div>
        )}
        {tokenDelta && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-600 uppercase">Tokens</span>
            <span className={`font-semibold ${tokenDelta.className}`}>{tokenDelta.text}</span>
          </div>
        )}
        {costDelta && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-600 uppercase">Cost</span>
            <span className={`font-semibold ${costDelta.className}`}>{costDelta.text}</span>
          </div>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[10px] text-zinc-600 uppercase">Span count</span>
          <span className="font-semibold text-zinc-300">{a.spans.length} → {b.spans.length}</span>
        </div>
      </div>

      {/* Input / Output diff */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-400">Trace Input</h2>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg py-2">
          <JsonDiff left={a.trace.input} right={b.trace.input} />
        </div>
        <h2 className="text-sm font-semibold text-zinc-400 pt-2">Trace Output</h2>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg py-2">
          <JsonDiff left={a.trace.output} right={b.trace.output} />
        </div>
      </section>

      {/* Span alignment */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-400">Aligned Spans</h2>
        <p className="text-xs text-zinc-600">Rows paired by span name; unpaired spans show only on one side.</p>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg divide-y divide-zinc-800/60">
          {pairs.map((pair, i) => (
            <SpanPairRow key={i} pair={pair} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-zinc-600 uppercase">{label}</p>
      <p className="font-semibold mt-0.5">{value}</p>
    </div>
  );
}

function SpanPairRow({ pair }: { pair: { a: Span | null; b: Span | null } }) {
  const [expanded, setExpanded] = useState(false);
  const { a, b } = pair;
  const bothPresent = a && b;
  const durationDelta = bothPresent ? delta(a.durationMs, b.durationMs) : null;
  const rowTint = !a ? "bg-emerald-950/20" : !b ? "bg-red-950/20" : "";

  return (
    <div className={rowTint}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full grid grid-cols-[1fr_auto_1fr] gap-4 items-center px-4 py-2.5 hover:bg-zinc-800/30 transition-colors text-left"
      >
        <SpanCell span={a} side="a" />
        <div className="text-xs text-zinc-500 font-mono w-20 text-center">
          {durationDelta ? <span className={durationDelta.className}>{durationDelta.text}</span> : <span>→</span>}
        </div>
        <SpanCell span={b} side="b" />
      </button>
      {expanded && bothPresent && (
        <div className="px-4 pb-3 grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">Input diff</p>
            <div className="bg-zinc-950 border border-zinc-800 rounded py-1">
              <JsonDiff left={a.input} right={b.input} />
            </div>
          </div>
          <div>
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">Output diff</p>
            <div className="bg-zinc-950 border border-zinc-800 rounded py-1">
              <JsonDiff left={a.output} right={b.output} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SpanCell({ span, side }: { span: Span | null; side: "a" | "b" }) {
  if (!span) {
    return (
      <div className="text-xs text-zinc-600 italic text-right">
        {side === "a" ? "(added in B)" : "(removed in B)"}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[span.status] || "bg-zinc-500"}`} />
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0">{span.type}</span>
      <span className="text-xs text-zinc-200 truncate font-medium">{span.name}</span>
      <span className="text-[10px] text-zinc-500 font-mono ml-auto shrink-0">{formatDuration(span.durationMs)}</span>
    </div>
  );
}
