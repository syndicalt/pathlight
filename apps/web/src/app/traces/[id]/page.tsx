"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchApi } from "../../../lib/api";
import { formatDuration, formatTokens } from "../../../lib/format";

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
  metadata: string | null;
  tags: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface Span {
  id: string;
  traceId: string;
  parentSpanId: string | null;
  name: string;
  type: string;
  status: string;
  input: string | null;
  output: string | null;
  error: string | null;
  model: string | null;
  provider: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  toolName: string | null;
  toolArgs: string | null;
  toolResult: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  metadata: string | null;
}

interface SpanEvent {
  id: string;
  spanId: string | null;
  name: string;
  level: string;
  body: string | null;
  timestamp: string;
}

const TYPE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  llm: { bg: "bg-blue-900/30", text: "text-blue-300", border: "border-blue-800/50" },
  tool: { bg: "bg-emerald-900/30", text: "text-emerald-300", border: "border-emerald-800/50" },
  retrieval: { bg: "bg-violet-900/30", text: "text-violet-300", border: "border-violet-800/50" },
  agent: { bg: "bg-orange-900/30", text: "text-orange-300", border: "border-orange-800/50" },
  chain: { bg: "bg-cyan-900/30", text: "text-cyan-300", border: "border-cyan-800/50" },
  custom: { bg: "bg-zinc-800", text: "text-zinc-300", border: "border-zinc-700" },
};

const STATUS_DOT: Record<string, string> = {
  running: "bg-blue-500 animate-pulse",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
};

const ISSUE_PATTERN = /\bfail\b|failed|failure|error|exception|timeout|timed out|invalid|denied|refused|rejected|incomplete|truncat/i;

function spanHasIssues(span: Span): boolean {
  if (span.status === "failed") return true;
  if (span.error) return true;
  if (span.output && ISSUE_PATTERN.test(span.output)) return true;
  if (span.toolResult && ISSUE_PATTERN.test(span.toolResult)) return true;
  return false;
}

function parseJson(str: string | null): unknown {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return str; }
}

function JsonBlock({ data, label }: { data: unknown; label: string }) {
  if (data === null || data === undefined) return null;
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  if (!text || text === "null") return null;

  return (
    <div>
      <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">{label}</p>
      <pre className="bg-zinc-800/50 border border-zinc-700/50 rounded p-3 text-xs text-zinc-300 whitespace-pre-wrap font-mono max-h-60 overflow-y-auto">
        {text.length > 2000 ? text.slice(0, 2000) + "\n...(truncated)" : text}
      </pre>
    </div>
  );
}

function SpanInspector({ span, onClose }: { span: Span; onClose: () => void }) {
  const style = TYPE_STYLES[span.type] || TYPE_STYLES.custom;

  return (
    <div className="fixed top-0 right-0 h-screen w-[480px] bg-zinc-900 border-l border-zinc-800 z-40 overflow-y-auto shadow-2xl">
      <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 px-5 py-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${style.bg} ${style.text} ${style.border}`}>
            {span.type}
          </span>
          <h2 className="font-semibold text-sm truncate">{span.name}</h2>
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 shrink-0 ml-2">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="px-5 py-4 space-y-5">
        {/* Metadata grid */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-[10px] text-zinc-600 uppercase">Status</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[span.status] || "bg-zinc-500"}`} />
              <span className="text-zinc-300">{span.status}</span>
            </div>
          </div>
          <div>
            <span className="text-[10px] text-zinc-600 uppercase">Duration</span>
            <p className="text-zinc-300 mt-0.5">{formatDuration(span.durationMs)}</p>
          </div>
          {span.model && (
            <div>
              <span className="text-[10px] text-zinc-600 uppercase">Model</span>
              <p className="text-zinc-300 font-mono text-xs mt-0.5">{span.model}</p>
            </div>
          )}
          {span.provider && (
            <div>
              <span className="text-[10px] text-zinc-600 uppercase">Provider</span>
              <p className="text-zinc-300 mt-0.5">{span.provider}</p>
            </div>
          )}
          {(span.inputTokens || span.outputTokens) && (
            <div>
              <span className="text-[10px] text-zinc-600 uppercase">Tokens</span>
              <p className="text-zinc-300 font-mono text-xs mt-0.5">
                {span.inputTokens || 0} in / {span.outputTokens || 0} out
              </p>
            </div>
          )}
          {span.toolName && (
            <div>
              <span className="text-[10px] text-zinc-600 uppercase">Tool</span>
              <p className="text-zinc-300 font-mono text-xs mt-0.5">{span.toolName}</p>
            </div>
          )}
        </div>

        {span.error && (
          <div className="bg-red-900/20 border border-red-800/50 rounded-lg p-3">
            <p className="text-[10px] text-red-400 uppercase tracking-widest mb-1">Error</p>
            <p className="text-xs text-red-300">{span.error}</p>
          </div>
        )}

        <JsonBlock data={parseJson(span.input)} label="Input" />
        <JsonBlock data={parseJson(span.output)} label="Output" />
        <JsonBlock data={parseJson(span.toolArgs)} label="Tool Arguments" />
        <JsonBlock data={parseJson(span.toolResult)} label="Tool Result" />
        <JsonBlock data={parseJson(span.metadata)} label="Metadata" />
      </div>
    </div>
  );
}

export default function TraceDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [trace, setTrace] = useState<Trace | null>(null);
  const [spans, setSpans] = useState<Span[]>([]);
  const [events, setEvents] = useState<SpanEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);

  useEffect(() => {
    fetchApi<{ trace: Trace; spans: Span[]; events: SpanEvent[] }>(`/v1/traces/${id}`)
      .then((data) => {
        setTrace(data.trace);
        setSpans(data.spans);
        setEvents(data.events);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading || !trace) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8">
        <p className="text-zinc-500">Loading trace...</p>
      </div>
    );
  }

  // Calculate timeline scale
  const traceStart = new Date(spans[0]?.startedAt || trace.createdAt).getTime();
  const traceEnd = trace.totalDurationMs ? traceStart + trace.totalDurationMs : Date.now();
  const totalMs = traceEnd - traceStart;

  const tags: string[] = trace.tags ? JSON.parse(trace.tags) : [];

  return (
    <div className={`max-w-6xl mx-auto px-6 py-8 space-y-6 ${selectedSpan ? "mr-[480px]" : ""}`}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/" className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <div className={`w-2 h-2 rounded-full ${STATUS_DOT[trace.status] || "bg-zinc-500"}`} />
        <h1 className="text-xl font-bold">{trace.name}</h1>
        <span className="text-sm text-zinc-500">{trace.status}</span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <p className="text-[10px] text-zinc-600 uppercase">Duration</p>
          <p className="text-lg font-bold mt-1">{formatDuration(trace.totalDurationMs)}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <p className="text-[10px] text-zinc-600 uppercase">Spans</p>
          <p className="text-lg font-bold mt-1">{spans.length}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <p className="text-[10px] text-zinc-600 uppercase">Tokens</p>
          <p className="text-lg font-bold mt-1">{formatTokens(trace.totalTokens)}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <p className="text-[10px] text-zinc-600 uppercase">LLM Calls</p>
          <p className="text-lg font-bold mt-1">{spans.filter((s) => s.type === "llm").length}</p>
        </div>
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex gap-2">
          {tags.map((tag) => (
            <span key={tag} className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50">{tag}</span>
          ))}
        </div>
      )}

      {/* Input/Output */}
      <div className="grid grid-cols-2 gap-4">
        <JsonBlock data={parseJson(trace.input)} label="Trace Input" />
        <JsonBlock data={parseJson(trace.output)} label="Trace Output" />
      </div>

      {trace.error && (
        <div className="bg-red-900/20 border border-red-800/50 rounded-lg p-4">
          <p className="text-xs text-red-400 font-semibold mb-1">Error</p>
          <p className="text-sm text-red-300">{trace.error}</p>
        </div>
      )}

      {/* Timeline */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-400 mb-3">Execution Timeline</h2>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          {/* Time axis */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 text-[10px] text-zinc-600">
            <span>0ms</span>
            <span>{formatDuration(totalMs)}</span>
          </div>

          {/* Spans as a waterfall */}
          <div className="divide-y divide-zinc-800/50">
            {spans.map((span) => {
              const spanStart = new Date(span.startedAt).getTime();
              const spanDuration = span.durationMs || (Date.now() - spanStart);
              const offsetPct = ((spanStart - traceStart) / totalMs) * 100;
              const widthPct = Math.max((spanDuration / totalMs) * 100, 0.5);
              const style = TYPE_STYLES[span.type] || TYPE_STYLES.custom;
              const isSelected = selectedSpan?.id === span.id;
              const hasIssue = spanHasIssues(span);

              return (
                <div
                  key={span.id}
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                    isSelected ? "bg-zinc-800/60" : hasIssue ? "bg-amber-950/20 hover:bg-amber-950/30" : "hover:bg-zinc-800/30"
                  }`}
                  onClick={() => setSelectedSpan(isSelected ? null : span)}
                >
                  {/* Label */}
                  <div className="w-48 shrink-0 flex items-center gap-2 min-w-0">
                    {hasIssue && (
                      <svg className="w-3.5 h-3.5 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                    )}
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium border shrink-0 ${hasIssue ? "bg-amber-900/30 text-amber-300 border-amber-800/50" : `${style.bg} ${style.text} ${style.border}`}`}>
                      {span.type}
                    </span>
                    <span className={`text-xs truncate ${hasIssue ? "text-amber-200" : "text-zinc-300"}`}>{span.name}</span>
                  </div>

                  {/* Waterfall bar */}
                  <div className="flex-1 relative h-6">
                    <div className="absolute inset-0 bg-zinc-800/30 rounded" />
                    <div
                      className={`absolute top-0 h-full rounded ${
                        span.status === "failed" ? "bg-red-600/60" : hasIssue ? "bg-amber-600/40" : style.bg.replace("/30", "/60")
                      }`}
                      style={{
                        left: `${offsetPct}%`,
                        width: `${widthPct}%`,
                        minWidth: "4px",
                      }}
                    />
                  </div>

                  {/* Duration + tokens */}
                  <div className="w-28 shrink-0 text-right">
                    <span className="text-xs text-zinc-400">{formatDuration(span.durationMs)}</span>
                    {span.inputTokens ? (
                      <span className="text-[10px] text-zinc-600 ml-2">
                        {span.inputTokens}+{span.outputTokens}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Span Inspector Panel */}
      {selectedSpan && (
        <SpanInspector span={selectedSpan} onClose={() => setSelectedSpan(null)} />
      )}
    </div>
  );
}
