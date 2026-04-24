import { relative, isAbsolute } from "node:path";
import type { LlmMessage, LlmToolSpec } from "./llm/index.js";
import type { FileContent, SourceReader } from "./source/path.js";
import type { SpanRecord, TraceWithSpans } from "./collector-client.js";
import type { FixMode } from "./types.js";

export const PROPOSE_FIX_TOOL: LlmToolSpec = {
  name: "propose_fix",
  description:
    "Propose a minimal fix for the failing trace as a unified diff. The diff must be in git-apply-compatible format with ---/+++ headers and @@ hunks. Only include files you are actually modifying.",
  inputSchema: {
    type: "object",
    properties: {
      explanation: {
        type: "string",
        description: "1-3 sentence plain-English explanation of the fix and why it solves the failure.",
      },
      diff: {
        type: "string",
        description: "Unified diff in git-apply format. Use a/ and b/ prefixes on paths. Must apply cleanly.",
      },
      filesChanged: {
        type: "array",
        items: { type: "string" },
        description: "Paths of files the diff modifies, relative to the source root.",
      },
    },
    required: ["explanation", "diff", "filesChanged"],
  },
};

/** Pull file paths out of spans' `_source` metadata, relative to the source root. */
export function inferFilesFromSpans(spans: SpanRecord[], sourceRoot: string): string[] {
  const seen = new Set<string>();
  for (const span of spans) {
    if (!span.metadata) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(span.metadata);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const source = (parsed as { _source?: { file?: string } })._source;
    if (!source?.file) continue;
    const abs = isAbsolute(source.file) ? source.file : source.file;
    if (!abs.startsWith(sourceRoot)) continue;
    const rel = relative(sourceRoot, abs);
    if (rel && !rel.startsWith("..")) seen.add(rel);
  }
  return [...seen];
}

function summarizeSpan(span: SpanRecord): string {
  const lines = [
    `- ${span.name} [${span.type}] [${span.status}]`,
  ];
  if (span.error) lines.push(`  error: ${span.error}`);
  if (span.model) lines.push(`  model: ${span.model}`);
  if (span.toolName) lines.push(`  tool: ${span.toolName}`);
  if (span.input) lines.push(`  input: ${truncate(span.input, 500)}`);
  if (span.output) lines.push(`  output: ${truncate(span.output, 500)}`);
  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + `…[${s.length - n} more chars]`;
}

export interface PromptBuildResult {
  messages: LlmMessage[];
  candidateFiles: string[];
}

export async function buildPrompt(
  traceData: TraceWithSpans,
  reader: SourceReader,
  mode: FixMode,
): Promise<PromptBuildResult> {
  const { trace, spans } = traceData;
  const failingSpans = spans.filter((s) => s.status === "failed" || s.error);
  const candidateFiles = inferFilesFromSpans(spans, reader.rootDir);

  let fileContents: FileContent[] = [];
  if (candidateFiles.length > 0) {
    fileContents = await reader.readFiles(candidateFiles);
  }

  const system = [
    "You are a senior engineer debugging a failing AI-agent trace in Pathlight.",
    "The user gives you the failing trace, its spans, and the relevant source files.",
    "Your job: propose the smallest diff that fixes the root cause.",
    "Rules:",
    "- Output the diff via the propose_fix tool — not as prose.",
    "- Use unified diff format with a/ and b/ path prefixes.",
    "- Never rewrite files wholesale. Prefer minimal targeted hunks.",
    "- Never modify files you were not shown.",
    "- If you cannot confidently fix the issue, explain what additional context is needed in the explanation field and return an empty diff.",
  ].join("\n");

  const userSections: string[] = [];
  userSections.push(`# Failing trace\n\n**Name:** ${trace.name}\n**Status:** ${trace.status}`);
  if (trace.gitCommit) {
    userSections.push(
      `**Git:** ${trace.gitCommit}${trace.gitBranch ? ` (${trace.gitBranch})` : ""}${trace.gitDirty ? " [dirty]" : ""}`,
    );
  }
  if (trace.error) userSections.push(`**Trace error:** ${trace.error}`);
  if (trace.input) userSections.push(`**Input:**\n\`\`\`\n${truncate(trace.input, 2000)}\n\`\`\``);
  if (trace.output) userSections.push(`**Output:**\n\`\`\`\n${truncate(trace.output, 2000)}\n\`\`\``);

  if (failingSpans.length > 0) {
    userSections.push(
      `# Failing spans (${failingSpans.length})\n\n${failingSpans.map(summarizeSpan).join("\n\n")}`,
    );
  }

  if (spans.length > failingSpans.length) {
    const context = spans.filter((s) => !failingSpans.includes(s));
    userSections.push(
      `# Context spans (${context.length})\n\n${context.slice(0, 20).map(summarizeSpan).join("\n\n")}`,
    );
  }

  if (fileContents.length > 0) {
    const fileBlocks = fileContents.map(
      (f) => `## ${f.path}\n\n\`\`\`\n${f.content}\n\`\`\``,
    );
    userSections.push(`# Source files\n\n${fileBlocks.join("\n\n")}`);
  } else {
    userSections.push(
      `# Source files\n\n_No file references were found in span metadata. Infer likely files from the trace context above and request them explicitly in your explanation if you cannot propose a fix._`,
    );
  }

  userSections.push(
    `# Task\n\nMode: \`${mode.kind}\`. Call propose_fix with the minimal diff that fixes the root cause above.`,
  );

  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: userSections.join("\n\n") },
    ],
    candidateFiles,
  };
}
