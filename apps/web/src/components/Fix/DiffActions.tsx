"use client";

import { useState } from "react";
import { COLLECTOR_URL } from "../../lib/api";

interface DiffActionsProps {
  diff: string;
  /** Null when the run used a git source — apply is path-mode only. */
  sourceDir: string | null;
  traceId: string;
}

type ApplyState = { kind: "idle" } | { kind: "applying" } | { kind: "applied" } | { kind: "error"; message: string };

export function DiffActions({ diff, sourceDir, traceId }: DiffActionsProps) {
  const [state, setState] = useState<ApplyState>({ kind: "idle" });

  const applyToTree = async (): Promise<void> => {
    if (!sourceDir) return;
    setState({ kind: "applying" });
    try {
      const res = await fetch(`${COLLECTOR_URL}/v1/fix-apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
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

  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-2">
        {sourceDir && (
          <button
            type="button"
            disabled={state.kind === "applying"}
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
