"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchApi, patchApi } from "../../../lib/api";
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
  reviewedAt: string | null;
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
  const meta = parseJson(span.metadata) as Record<string, unknown> | null;
  const source = meta?._source as { file?: string; line?: number; func?: string } | undefined;
  const isLlm = span.type === "llm";

  return (
    <aside className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden flex flex-col">
      <div className="border-b border-zinc-800 px-5 py-3 flex items-center gap-3">
        <span className={`px-2 py-0.5 rounded text-[10px] font-medium border shrink-0 ${style.bg} ${style.text} ${style.border}`}>
          {span.type}
        </span>
        <h2 className="font-semibold text-sm truncate">{span.name}</h2>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[span.status] || "bg-zinc-500"}`} />
          <span className="text-xs text-zinc-400">{span.status}</span>
        </div>
        <span className="text-xs text-zinc-500 font-mono shrink-0">{formatDuration(span.durationMs)}</span>
        {(span.inputTokens || span.outputTokens) ? (
          <span className="text-xs text-zinc-500 font-mono shrink-0">{span.inputTokens || 0}/{span.outputTokens || 0} tok</span>
        ) : null}
        <button onClick={onClose} className="ml-auto text-zinc-500 hover:text-zinc-300 shrink-0" aria-label="Close inspector">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="px-5 py-4 space-y-4 overflow-y-auto">
        {span.error && (
          <div className="bg-red-900/20 border border-red-800/50 rounded-lg p-3">
            <p className="text-[10px] text-red-400 uppercase tracking-widest mb-1">Error</p>
            <p className="text-xs text-red-300">{span.error}</p>
          </div>
        )}

        {source?.file && (
          <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 flex items-center gap-3 text-xs flex-wrap">
            <span className="text-[10px] text-zinc-600 uppercase tracking-widest">Source</span>
            <code className="text-blue-400 font-mono">
              {source.file.split("/").slice(-2).join("/")}:{source.line}
            </code>
            {source.func && source.func !== "(anonymous)" && (
              <span className="text-zinc-500">in <span className="text-zinc-400">{source.func}()</span></span>
            )}
          </div>
        )}

        {isLlm && <ReplayPanel span={span} />}

        <div className="space-y-3">
          <JsonBlock data={parseJson(span.input)} label={isLlm ? "Original Input" : "Input"} />
          <JsonBlock data={parseJson(span.output)} label={isLlm ? "Original Output" : "Output"} />
          {!isLlm && <JsonBlock data={parseJson(span.toolArgs)} label="Tool Arguments" />}
          {!isLlm && <JsonBlock data={parseJson(span.toolResult)} label="Tool Result" />}
          <JsonBlock data={parseJson(span.metadata)} label="Metadata" />
        </div>
      </div>
    </aside>
  );
}

interface ReplayMessage { role: string; content: string }

// Multimodal payloads ship `content` as an array of parts ({type:"text", text:"…"},
// {type:"image_url", ...}). Our editor is text-only, so collapse parts to a string
// and preserve anything non-textual as a pretty-printed JSON sentinel.
function messageContentToString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const p = part as Record<string, unknown>;
          if (typeof p.text === "string") return p.text;
          if (typeof p.content === "string") return p.content;
        }
        return JSON.stringify(part);
      })
      .join("\n");
  }
  if (raw == null) return "";
  return JSON.stringify(raw, null, 2);
}

function extractMessages(span: Span): { messages: ReplayMessage[]; system?: string } {
  const parsed = parseJson(span.input);
  if (parsed && typeof parsed === "object" && "messages" in parsed && Array.isArray((parsed as { messages: unknown }).messages)) {
    const p = parsed as { messages: Array<{ role: string; content: unknown }>; system?: unknown };
    const all = p.messages.map((m) => ({
      role: String(m.role ?? "user"),
      content: messageContentToString(m.content),
    }));
    const system = typeof p.system === "string"
      ? p.system
      : all[0]?.role === "system"
        ? all[0].content
        : undefined;
    const messages = all[0]?.role === "system" ? all.slice(1) : all;
    return { messages, system };
  }
  // Fall back: treat input as a single user message
  const content = typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
  return { messages: [{ role: "user", content }] };
}

function ReplayPanel({ span }: { span: Span }) {
  const initial = extractMessages(span);
  const [messages, setMessages] = useState<ReplayMessage[]>(initial.messages);
  const [system, setSystem] = useState<string>(initial.system ?? "");
  const [model, setModel] = useState(span.model ?? "");
  const [apiKey, setApiKey] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ output: string; durationMs: number; tokens?: string; error?: string } | null>(null);

  const COLLECTOR_URL = process.env.NEXT_PUBLIC_COLLECTOR_URL || "http://localhost:4100";

  useEffect(() => {
    // Load stored API key if present (scoped per provider).
    const provider = (span.provider || "openai").toLowerCase();
    const stored = typeof window !== "undefined" ? localStorage.getItem(`pathlight:replay-key:${provider}`) : null;
    if (stored) setApiKey(stored);
  }, [span.provider]);

  // Keep the editor fresh when jumping between spans.
  useEffect(() => {
    const next = extractMessages(span);
    setMessages(next.messages);
    setSystem(next.system ?? "");
    setModel(span.model ?? "");
    setResult(null);
  }, [span.id, span.model]);

  const provider = (span.provider || "openai").toLowerCase();

  const run = async () => {
    if (apiKey) {
      localStorage.setItem(`pathlight:replay-key:${provider}`, apiKey);
    }
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`${COLLECTOR_URL}/v1/replay/llm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model,
          system: system || undefined,
          messages,
          apiKey: apiKey || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ output: "", durationMs: 0, error: JSON.stringify(data.error || data, null, 2) });
      } else {
        setResult({
          output: data.output || "",
          durationMs: data.durationMs || 0,
          tokens: data.inputTokens ? `${data.inputTokens}/${data.outputTokens || 0}` : undefined,
        });
      }
    } catch (err) {
      setResult({ output: "", durationMs: 0, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="pt-4 border-t border-zinc-800">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] text-zinc-600 uppercase tracking-widest">Replay</p>
        <span className="text-[10px] text-zinc-600">{provider}</span>
      </div>

      <div className="space-y-2">
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="model"
          className="w-full bg-zinc-800/50 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-zinc-200"
        />
        {system !== undefined && (
          <textarea
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            placeholder="system prompt (optional)"
            rows={2}
            className="w-full bg-zinc-800/50 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-zinc-300"
          />
        )}
        {messages.map((m, i) => (
          <div key={i} className="border border-zinc-700 rounded">
            <div className="flex items-center justify-between px-2 py-1 bg-zinc-800/50">
              <select
                value={m.role}
                onChange={(e) => setMessages(messages.map((mm, idx) => (idx === i ? { ...mm, role: e.target.value } : mm)))}
                className="bg-zinc-800 border border-zinc-700 rounded text-[10px] px-1 py-0.5 text-zinc-300"
              >
                <option value="user">user</option>
                <option value="assistant">assistant</option>
                <option value="system">system</option>
              </select>
              <button
                onClick={() => setMessages(messages.filter((_, idx) => idx !== i))}
                className="text-[10px] text-zinc-500 hover:text-red-400"
              >
                remove
              </button>
            </div>
            <textarea
              value={m.content}
              onChange={(e) => setMessages(messages.map((mm, idx) => (idx === i ? { ...mm, content: e.target.value } : mm)))}
              rows={Math.min(8, Math.max(2, (typeof m.content === "string" ? m.content : "").split("\n").length))}
              className="w-full bg-zinc-900 px-2 py-1 text-xs font-mono text-zinc-200 border-t border-zinc-700 focus:outline-none"
            />
          </div>
        ))}
        <button
          onClick={() => setMessages([...messages, { role: "user", content: "" }])}
          className="text-[10px] text-zinc-500 hover:text-zinc-300"
        >
          + add message
        </button>

        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={`${provider} api key (saved locally; collector env var also works)`}
          className="w-full bg-zinc-800/50 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-zinc-200"
        />

        <button
          onClick={run}
          disabled={running || !model}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-xs font-medium px-3 py-2 rounded transition-colors"
        >
          {running ? "Running…" : "Run replay"}
        </button>
      </div>

      {result && (
        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between text-[10px] text-zinc-600 uppercase tracking-widest">
            <span>Replay output</span>
            <span>
              {result.durationMs}ms{result.tokens ? ` · ${result.tokens} tok` : ""}
            </span>
          </div>
          {result.error ? (
            <pre className="bg-red-950/40 border border-red-800/50 rounded p-2 text-[11px] text-red-300 whitespace-pre-wrap max-h-40 overflow-y-auto">{result.error}</pre>
          ) : (
            <pre className="bg-zinc-800/50 border border-zinc-700/50 rounded p-2 text-[11px] text-zinc-200 whitespace-pre-wrap font-mono max-h-60 overflow-y-auto">{result.output}</pre>
          )}
        </div>
      )}
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
  const inspectorRef = useRef<HTMLDivElement | null>(null);

  // Close the inspector with Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedSpan) setSelectedSpan(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedSpan]);

  // Scroll the inspector into view on selection.
  useEffect(() => {
    if (selectedSpan && inspectorRef.current) {
      inspectorRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedSpan?.id]);

  useEffect(() => {
    fetchApi<{ trace: Trace; spans: Span[]; events: SpanEvent[] }>(`/v1/traces/${id}`)
      .then((data) => {
        setTrace(data.trace);
        setSpans(data.spans);
        setEvents(data.events);

        if (data.trace && !data.trace.reviewedAt) {
          const reviewedAt = new Date().toISOString();
          setTrace((prev) => (prev ? { ...prev, reviewedAt } : prev));
          patchApi(`/v1/traces/${id}`, { reviewedAt }).catch(console.error);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading || !trace) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
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
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
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

      {/* Timeline + (optional) side-by-side inspector */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-400 mb-3">Execution Timeline</h2>
        <div className={`grid gap-4 ${selectedSpan ? "grid-cols-1 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]" : "grid-cols-1"}`}>
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
                    <div className="w-40 shrink-0 flex items-center gap-2 min-w-0">
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
                    <div className="flex-1 relative h-5 bg-zinc-800/40 rounded overflow-hidden min-w-0">
                      <div
                        className={`absolute top-0 h-full rounded ${
                          span.status === "failed" ? "bg-red-500" : hasIssue ? "bg-amber-500" : span.type === "llm" ? "bg-blue-500" : span.type === "tool" ? "bg-emerald-500" : span.type === "retrieval" ? "bg-violet-500" : "bg-zinc-500"
                        }`}
                        style={{
                          left: `${offsetPct}%`,
                          width: `${widthPct}%`,
                          minWidth: "4px",
                          opacity: 0.7,
                        }}
                      />
                    </div>

                    {/* Duration + tokens */}
                    <div className="shrink-0 text-right">
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

          {selectedSpan && (
            <div ref={inspectorRef} className="lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)]">
              <SpanInspector span={selectedSpan} onClose={() => setSelectedSpan(null)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
