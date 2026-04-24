import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fix, type LlmProvider, type FixProgress } from "@pathlight/fix";

export interface FixCliOptions {
  traceId: string;
  sourceDir: string;
  provider: LlmProvider;
  model?: string;
  apply: boolean;
  collectorUrl: string;
  apiKey: string;
}

export async function runFix(options: FixCliOptions): Promise<{ applied: boolean; diff: string }> {
  const onProgress = (event: FixProgress): void => {
    process.stderr.write(progressLine(event) + "\n");
  };

  const result = await fix({
    traceId: options.traceId,
    collectorUrl: options.collectorUrl,
    source: { kind: "path", dir: resolve(options.sourceDir) },
    llm: {
      provider: options.provider,
      apiKey: options.apiKey,
      model: options.model,
    },
    mode: { kind: "span" },
    onProgress,
  });

  process.stdout.write(result.diff + (result.diff.endsWith("\n") ? "" : "\n"));
  process.stderr.write(`\n# Explanation\n${result.explanation}\n`);
  if (result.filesChanged.length > 0) {
    process.stderr.write(`# Files changed: ${result.filesChanged.join(", ")}\n`);
  }

  if (!options.apply) {
    return { applied: false, diff: result.diff };
  }
  if (result.diff.trim().length === 0) {
    process.stderr.write("# --apply skipped: engine returned an empty diff\n");
    return { applied: false, diff: result.diff };
  }

  await applyDiff(result.diff, resolve(options.sourceDir));
  process.stderr.write("# Applied to working tree.\n");
  return { applied: true, diff: result.diff };
}

function progressLine(event: FixProgress): string {
  switch (event.kind) {
    case "fetching-trace":
      return "# fetching trace...";
    case "reading-source":
      return `# reading source (${event.fileCount} file${event.fileCount === 1 ? "" : "s"})...`;
    case "calling-llm":
      return `# calling ${event.provider} ${event.model}...`;
    case "parsing-diff":
      return "# parsing diff...";
    case "bisect-iteration":
      return `# bisecting (depth ${event.depth}) at ${event.sha.slice(0, 7)}`;
    case "bisect-found":
      return `# regression found at ${event.sha.slice(0, 7)}`;
  }
}

function applyDiff(diff: string, cwd: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", ["apply", "--whitespace=nowarn", "-"], { cwd, stdio: ["pipe", "inherit", "inherit"] });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`git apply exited with code ${code ?? "unknown"}`));
    });
    child.stdin.write(diff);
    child.stdin.end();
  });
}
