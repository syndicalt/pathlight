"use client";

import { useState } from "react";
import { COLLECTOR_URL, pathlightHeaders } from "../../lib/api";

interface DiffActionsProps {
  diff: string;
  /** Null when the run used a git source — apply is path-mode only. */
  sourceDir: string | null;
  traceId: string;
}

type ApplyState = { kind: "idle" } | { kind: "applying" } | { kind: "applied" } | { kind: "error"; message: string };

function downloadDiff(diff: string, traceId: string): void {
  const blob = new Blob([diff], { type: "text/x-diff" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `pathlight-fix-${traceId.slice(0, 12)}.patch`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function DiffActions({ diff, sourceDir, traceId }: DiffActionsProps) {
  const [state, setState] = useState<ApplyState>({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  const applyToTree = async (): Promise<void> => {
    if (!sourceDir) return;
    setState({ kind: "applying" });
    try {
      const res = await fetch(`${COLLECTOR_URL}/v1/fix-apply`, {
        method: "POST",
        headers: pathlightHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ sourceDir, diff }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; detail?: string } };
        setState({ kind: "error", message: body.error?.detail ?? body.error?.message ?? `apply failed: ${res.status}` });
        return;
      }
      setState({ kind: "applied" });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const copyToClipboard = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(diff);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const disabled = diff.trim().length === 0;

  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-2 flex-wrap">
        {sourceDir && (
          <button
            type="button"
            disabled={disabled || state.kind === "applying"}
            onClick={() => void applyToTree()}
            className="px-3 py-1.5 rounded text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50"
            title={`git apply the diff inside ${sourceDir}`}
          >
            {state.kind === "applying"
              ? "Applying…"
              : state.kind === "applied"
                ? "Applied ✓"
                : "Apply to working tree"}
          </button>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => downloadDiff(diff, traceId)}
          className="px-3 py-1.5 rounded text-xs font-medium bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-700 disabled:opacity-50"
        >
          Download .patch
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void copyToClipboard()}
          className="px-3 py-1.5 rounded text-xs font-medium bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-700 disabled:opacity-50"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <div className="text-xs text-zinc-500 font-mono truncate" title={`trace ${traceId}`}>
        {sourceDir ?? "git source — apply via CLI"}
      </div>
      {state.kind === "error" && (
        <div className="w-full bg-red-950/40 border border-red-900 rounded px-2 py-1 text-[11px] text-red-300 font-mono whitespace-pre-wrap">
          {state.message}
        </div>
      )}
    </div>
  );
}
