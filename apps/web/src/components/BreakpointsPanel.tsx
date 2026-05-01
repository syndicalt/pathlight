"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { COLLECTOR_URL, PATHLIGHT_ACCESS_TOKEN, pathlightHeaders } from "../lib/api";

interface Breakpoint {
  id: string;
  label: string;
  traceId: string | null;
  spanId: string | null;
  state: unknown;
  createdAt: string;
}

export function BreakpointsPanel() {
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>([]);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const retryRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let source: EventSource | null = null;

    const connect = () => {
      const token = PATHLIGHT_ACCESS_TOKEN
        ? `?access_token=${encodeURIComponent(PATHLIGHT_ACCESS_TOKEN)}`
        : "";
      source = new EventSource(`${COLLECTOR_URL}/v1/breakpoints/stream${token}`);

      source.addEventListener("snapshot", (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data) as { breakpoints: Breakpoint[] };
          setBreakpoints(data.breakpoints);
        } catch {}
      });
      source.addEventListener("added", (e) => {
        try {
          const bp = JSON.parse((e as MessageEvent).data) as Breakpoint;
          setBreakpoints((prev) => (prev.some((p) => p.id === bp.id) ? prev : [...prev, bp]));
          // Auto-open the panel when a new breakpoint arrives.
          setOpen(true);
        } catch {}
      });
      const removeById = (id: string) => setBreakpoints((prev) => prev.filter((p) => p.id !== id));
      source.addEventListener("resolved", (e) => {
        try {
          const { id } = JSON.parse((e as MessageEvent).data) as { id: string };
          removeById(id);
          setActiveId((a) => (a === id ? null : a));
        } catch {}
      });
      source.addEventListener("cancelled", (e) => {
        try {
          const { id } = JSON.parse((e as MessageEvent).data) as { id: string };
          removeById(id);
          setActiveId((a) => (a === id ? null : a));
        } catch {}
      });
      source.onerror = () => {
        source?.close();
        // Reconnect after a short backoff — the collector may have restarted.
        retryRef.current = setTimeout(connect, 2000);
      };
    };

    connect();
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      source?.close();
    };
  }, []);

  if (breakpoints.length === 0 && !open) return null;

  const active = breakpoints.find((b) => b.id === activeId) ?? breakpoints[0] ?? null;

  return (
    <>
      {/* Floating badge */}
      {!open && breakpoints.length > 0 && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-amber-500 hover:bg-amber-400 text-black font-medium shadow-2xl text-sm animate-pulse"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {breakpoints.length} paused
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-6 right-6 z-40 w-[520px] max-h-[80vh] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h2 className="text-sm font-semibold">Breakpoints</h2>
              <span className="text-xs text-zinc-500">{breakpoints.length}</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-zinc-500 hover:text-zinc-300"
              aria-label="Close breakpoint panel"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {breakpoints.length === 0 ? (
            <p className="text-xs text-zinc-500 px-4 py-6 text-center">No paused breakpoints.</p>
          ) : (
            <div className="flex flex-1 overflow-hidden">
              <ul className="w-48 border-r border-zinc-800 overflow-y-auto">
                {breakpoints.map((bp) => (
                  <li key={bp.id}>
                    <button
                      onClick={() => setActiveId(bp.id)}
                      className={`w-full text-left px-3 py-2.5 text-xs transition-colors ${
                        (active?.id === bp.id) ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800/50"
                      }`}
                    >
                      <span className="block font-medium truncate">{bp.label}</span>
                      <span className="block text-[10px] text-zinc-600 font-mono mt-0.5">{bp.id.slice(0, 10)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex-1 overflow-y-auto">
                {active && <BreakpointDetail bp={active} />}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function BreakpointDetail({ bp }: { bp: Breakpoint }) {
  const initial = JSON.stringify(bp.state, null, 2);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the editor in sync when the selected breakpoint changes.
  useEffect(() => {
    setDraft(JSON.stringify(bp.state, null, 2));
    setError(null);
  }, [bp.id, bp.state]);

  const resume = async (overrideState?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const body = overrideState === undefined
        ? { state: JSON.parse(draft) }
        : { state: overrideState };
      const res = await fetch(`${COLLECTOR_URL}/v1/breakpoints/${bp.id}/resume`, {
        method: "POST",
        headers: pathlightHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await fetch(`${COLLECTOR_URL}/v1/breakpoints/${bp.id}/cancel`, {
        method: "POST",
        headers: pathlightHeaders(),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-3 text-xs">
      <div>
        <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Label</p>
        <p className="text-zinc-200 font-medium">{bp.label}</p>
      </div>
      {bp.traceId && (
        <div>
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Trace</p>
          <Link href={`/traces/${bp.traceId}`} className="text-blue-400 hover:underline font-mono">
            {bp.traceId}
          </Link>
        </div>
      )}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest">State (editable)</p>
          <button
            onClick={() => setDraft(initial)}
            className="text-[10px] text-zinc-500 hover:text-zinc-300"
          >
            Reset
          </button>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="w-full h-48 bg-zinc-950 border border-zinc-800 rounded-md p-2 font-mono text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
        />
        {error && <p className="text-red-400 text-[11px] mt-1">{error}</p>}
      </div>
      <div className="flex items-center gap-2 pt-2">
        <button
          disabled={busy}
          onClick={() => resume(bp.state)}
          className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs disabled:opacity-50"
        >
          Resume as-is
        </button>
        <button
          disabled={busy}
          onClick={() => resume()}
          className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium disabled:opacity-50"
        >
          Resume with edits
        </button>
        <button
          disabled={busy}
          onClick={cancel}
          className="ml-auto px-3 py-1.5 rounded-md text-xs text-red-400 hover:bg-red-950/40 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
