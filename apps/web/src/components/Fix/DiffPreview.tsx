"use client";

import { useMemo, useState } from "react";
import { parseUnifiedDiff, type ParsedFile, type ParsedLine } from "./diff-parser";

/**
 * Unified-diff viewer. Rolls our own instead of pulling
 * react-diff-viewer-continued (~50KB gz) because (1) we don't need
 * side-by-side alignment for v1 — unified view with color-coded lines
 * communicates the change clearly at ~5KB — and (2) avoids pinning a
 * third-party rendering library's color palette / accessibility story
 * before we've seen real usage.
 */

export function DiffPreview({ diff }: { diff: string }) {
  const files = useMemo(() => parseUnifiedDiff(diff), [diff]);

  if (files.length === 0) {
    return (
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 text-sm text-zinc-500">
        Engine returned an empty diff. See the explanation above for what additional context is needed.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {files.map((file, i) => (
        <FilePanel key={i} file={file} />
      ))}
    </div>
  );
}

function FilePanel({ file }: { file: ParsedFile }) {
  const [expanded, setExpanded] = useState(true);
  const addCount = file.hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === "add").length, 0);
  const removeCount = file.hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === "remove").length, 0);

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 border-b border-zinc-800 flex items-center gap-3 text-left hover:bg-zinc-900"
      >
        <svg
          className={`w-3 h-3 text-zinc-500 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <code className="font-mono text-xs text-zinc-300 truncate">
          {file.newPath === "/dev/null" ? file.oldPath : file.newPath}
        </code>
        <span className="ml-auto text-xs font-mono flex items-center gap-2 shrink-0">
          <span className="text-emerald-400">+{addCount}</span>
          <span className="text-red-400">-{removeCount}</span>
        </span>
      </button>
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-[11px]">
            <tbody>
              {file.hunks.flatMap((hunk, hi) => [
                <tr key={`h-${hi}`} className="bg-blue-900/15">
                  <td className="px-3 py-0.5 text-blue-300 whitespace-pre">{hunk.header}</td>
                </tr>,
                ...hunk.lines.map((line, li) => (
                  <tr key={`l-${hi}-${li}`} className={lineBg(line.kind)}>
                    <td className={`px-3 py-0.5 whitespace-pre ${lineText(line.kind)}`}>
                      {line.text}
                    </td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function lineBg(kind: ParsedLine["kind"]): string {
  switch (kind) {
    case "add":
      return "bg-emerald-900/20";
    case "remove":
      return "bg-red-900/20";
    case "meta":
      return "bg-zinc-900/60";
    default:
      return "";
  }
}

function lineText(kind: ParsedLine["kind"]): string {
  switch (kind) {
    case "add":
      return "text-emerald-300";
    case "remove":
      return "text-red-300";
    case "meta":
      return "text-zinc-500";
    default:
      return "text-zinc-300";
  }
}
