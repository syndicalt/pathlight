"use client";

import { useEffect, useRef, useState } from "react";
import { COLLECTOR_URL } from "../../lib/api";
import { openSSE, type SSEEvent } from "../../lib/sse";
import type { FixFormValue } from "./FixForm";

export interface FixResultPayload {
  diff: string;
  explanation: string;
  filesChanged: string[];
  metaTraceId?: string;
  regressionSha?: string;
  parentSha?: string;
}

interface FixStreamProps {
  projectId: string;
  traceId: string;
  form: FixFormValue;
  onResult: (result: FixResultPayload) => void;
  onFail: (message: string) => void;
}

interface ProgressEntry {
  id: number;
  text: string;
}

export function FixStream({ projectId, traceId, form, onResult, onFail }: FixStreamProps) {
  const [progress, setProgress] = useState<ProgressEntry[]>([]);
  const [closed, setClosed] = useState(false);
  const idRef = useRef(0);

  // Keep callbacks in refs so they don't appear in the effect's deps. The
  // parent (FixDialog) passes fresh inline closures every render; without
  // this indirection any unrelated re-render of the dialog would tear
  // down + abort the in-flight SSE stream. In React StrictMode (Next.js
  // dev) the abort flips phase → error and unmounts FixStream before the
  // second mount can complete, so submission appeared to fail instantly.
  const onResultRef = useRef(onResult);
  const onFailRef = useRef(onFail);
  useEffect(() => {
    onResultRef.current = onResult;
    onFailRef.current = onFail;
  }, [onResult, onFail]);

  useEffect(() => {
    const controller = new AbortController();
    // Distinguish caller-driven aborts (effect cleanup, e.g. on unmount)
    // from real network/SSE failures so cleanup never reaches onFail.
    let cleanedUp = false;

    const pushProgress = (text: string): void => {
      idRef.current += 1;
      const entry = { id: idRef.current, text };
      setProgress((prev) => [...prev, entry]);
    };

    const body = {
      traceId,
      projectId,
      source: form.source,
      llm: form.llm,
      mode: form.mode.kind,
      ...(form.mode.kind === "bisect" ? { from: form.mode.from, to: form.mode.to } : {}),
    };

    void openSSE({
      url: `${COLLECTOR_URL}/v1/fix`,
      body,
      signal: controller.signal,
      onEvent: (event: SSEEvent) => {
        switch (event.event) {
          case "progress": {
            pushProgress(progressLine(safeJson(event.data)));
            return;
          }
          case "chunk": {
            pushProgress("received partial chunk");
            return;
          }
          case "result": {
            const parsed = safeJson(event.data) as FixResultPayload;
            onResultRef.current(parsed);
            return;
          }
          case "error": {
            const parsed = safeJson(event.data) as { message?: string };
            onFailRef.current(parsed?.message ?? "Fix engine failed");
            return;
          }
          case "done": {
            setClosed(true);
            return;
          }
        }
      },
      onError: (err) => {
        if (cleanedUp || controller.signal.aborted) return;
        onFailRef.current(err instanceof Error ? err.message : "Connection error");
      },
      onClose: () => setClosed(true),
    });

    return () => {
      cleanedUp = true;
      controller.abort();
    };
  }, [projectId, traceId, form]);

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg">
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center gap-2">
        <div className={`w-1.5 h-1.5 rounded-full ${closed ? "bg-zinc-600" : "bg-blue-500 animate-pulse"}`} />
        <span className="text-xs text-zinc-400">
          {closed ? "Stream closed" : "Streaming fix engine…"}
        </span>
      </div>
      <div className="px-3 py-2 max-h-48 overflow-y-auto font-mono text-[11px] text-zinc-500 space-y-0.5">
        {progress.length === 0 && !closed && (
          <p className="text-zinc-600">Waiting for first event…</p>
        )}
        {progress.map((p) => (
          <div key={p.id}>{p.text}</div>
        ))}
      </div>
    </div>
  );
}

function progressLine(event: unknown): string {
  if (!event || typeof event !== "object") return "progress";
  const e = event as { kind?: string; fileCount?: number; provider?: string; model?: string; sha?: string; depth?: number };
  switch (e.kind) {
    case "fetching-trace":
      return "# fetching trace";
    case "reading-source":
      return `# reading source (${e.fileCount ?? 0} file${e.fileCount === 1 ? "" : "s"})`;
    case "calling-llm":
      return `# calling ${e.provider ?? ""} ${e.model ?? ""}`.trim();
    case "parsing-diff":
      return "# parsing diff";
    case "bisect-iteration":
      return `# bisect depth ${e.depth ?? "?"} at ${(e.sha ?? "").slice(0, 7)}`;
    case "bisect-found":
      return `# regression found at ${(e.sha ?? "").slice(0, 7)}`;
    default:
      return `# ${e.kind ?? "progress"}`;
  }
}

function safeJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
