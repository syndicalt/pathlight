import type { FixResultPayload } from "./FixStream";
import type { SSEEvent } from "../../lib/sse";

export type FixStreamAction =
  | { kind: "progress"; text: string }
  | { kind: "result"; result: FixResultPayload }
  | { kind: "error"; message: string }
  | { kind: "closed" }
  | { kind: "ignored" };

export function fixStreamAction(event: SSEEvent): FixStreamAction {
  switch (event.event) {
    case "progress":
      return { kind: "progress", text: progressLine(safeJson(event.data)) };
    case "chunk":
      return { kind: "progress", text: "received partial chunk" };
    case "result":
      return { kind: "result", result: safeJson(event.data) as FixResultPayload };
    case "error": {
      const parsed = safeJson(event.data) as { message?: string } | null;
      return { kind: "error", message: parsed?.message ?? "Fix engine failed" };
    }
    case "done":
      return { kind: "closed" };
    default:
      return { kind: "ignored" };
  }
}

export function progressLine(event: unknown): string {
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

export function safeJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
