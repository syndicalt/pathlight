"use client";

import { useEffect, useState } from "react";
import { FixForm, type FixFormValue } from "./FixForm";
import { FixStream, type FixResultPayload } from "./FixStream";
import { DiffPreview } from "./DiffPreview";
import { DiffActions } from "./DiffActions";
import { BisectBanner } from "./BisectBanner";

export interface FixContext {
  traceId: string;
  spanId?: string;
  projectId: string | null;
}

type Phase =
  | { kind: "idle" }
  | { kind: "streaming"; form: FixFormValue }
  | { kind: "done"; form: FixFormValue; result: FixResultPayload }
  | { kind: "error"; form: FixFormValue; message: string };

interface FixDialogProps {
  open: boolean;
  context: FixContext | null;
  onClose: () => void;
}

export function FixDialog({ open, context, onClose }: FixDialogProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const submitting = phase.kind === "streaming";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, submitting]);

  useEffect(() => {
    if (!open) setPhase({ kind: "idle" });
  }, [open]);

  if (!open || !context) return null;

  const handleSubmit = (form: FixFormValue): void => {
    setPhase({ kind: "streaming", form });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Propose a fix"
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="border-b border-zinc-800 px-5 py-3 flex items-center gap-3">
          <h2 className="font-semibold">Propose a fix</h2>
          <span className="text-xs text-zinc-500 font-mono truncate">
            trace {context.traceId.slice(0, 12)}
            {context.spanId ? ` · span ${context.spanId.slice(0, 8)}` : ""}
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="ml-auto text-zinc-500 hover:text-zinc-300 shrink-0 disabled:opacity-50"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-5 space-y-5 overflow-y-auto">
          <FixForm
            projectId={context.projectId}
            submitting={submitting}
            onSubmit={handleSubmit}
          />

          {phase.kind === "streaming" && context.projectId && (
            <FixStream
              projectId={context.projectId}
              traceId={context.traceId}
              form={phase.form}
              onResult={(result) => setPhase({ kind: "done", form: phase.form, result })}
              onFail={(message) => setPhase({ kind: "error", form: phase.form, message })}
            />
          )}

          {phase.kind === "error" && (
            <div className="bg-red-950/40 border border-red-900 rounded-lg p-3 text-sm text-red-300">
              {phase.message}
            </div>
          )}

          {phase.kind === "done" && (
            <div className="space-y-3">
              {phase.result.regressionSha && (
                <BisectBanner
                  regressionSha={phase.result.regressionSha}
                  parentSha={phase.result.parentSha}
                />
              )}
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 space-y-2">
                <p className="text-[10px] text-zinc-600 uppercase tracking-widest">Explanation</p>
                <p className="text-sm text-zinc-300">{phase.result.explanation}</p>
              </div>
              <DiffPreview diff={phase.result.diff} />
              <DiffActions
                diff={phase.result.diff}
                sourceDir={phase.form.source.kind === "path" ? phase.form.source.dir : null}
                traceId={context.traceId}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
