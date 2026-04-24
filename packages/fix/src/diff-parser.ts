import { FixError } from "./types.js";
import type { CompletionResult } from "./llm/index.js";

export interface ParsedFix {
  explanation: string;
  diff: string;
  filesChanged: string[];
}

export function parseFixResponse(completion: CompletionResult): ParsedFix {
  const toolCall = completion.toolCalls.find((tc) => tc.name === "propose_fix");
  if (!toolCall) {
    throw new FixError(
      "Model did not call propose_fix. Raw response: " + truncate(completion.content, 400),
    );
  }

  const { explanation, diff, filesChanged } = toolCall.input as {
    explanation?: unknown;
    diff?: unknown;
    filesChanged?: unknown;
  };

  if (typeof explanation !== "string") {
    throw new FixError("propose_fix.explanation is not a string");
  }
  if (typeof diff !== "string") {
    throw new FixError("propose_fix.diff is not a string");
  }
  if (!Array.isArray(filesChanged) || !filesChanged.every((f) => typeof f === "string")) {
    throw new FixError("propose_fix.filesChanged is not an array of strings");
  }

  if (diff.trim().length > 0 && !isUnifiedDiff(diff)) {
    throw new FixError(
      "propose_fix.diff is not in unified diff format (missing ---/+++/@@ headers)",
    );
  }

  return { explanation, diff, filesChanged };
}

export function isUnifiedDiff(diff: string): boolean {
  return /^---\s/m.test(diff) && /^\+\+\+\s/m.test(diff) && /^@@\s/m.test(diff);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}
