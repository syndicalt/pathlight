import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fix, type LlmProvider, type FixProgress, type Source, type FixMode } from "@pathlight/fix";

export interface FixCliOptions {
  traceId: string;
  /** Local source directory. Required unless `gitUrl` is given. */
  sourceDir?: string;
  /** Git source URL. When set, `token` must also be set. Ignored if `sourceDir` is given. */
  gitUrl?: string;
  /** BYOG (bring-your-own-git-token). Never logged, never echoed. */
  token?: string;
  /** Git ref to check out on clone. Defaults to HEAD. */
  ref?: string;
  /** Bisect mode: known-good SHA (older). Required with `--bisect`. */
  from?: string;
  /** Bisect mode: known-bad SHA (newer). Required with `--bisect`. */
  to?: string;
  /** Opt into bisect mode. */
  bisect?: boolean;
  provider: LlmProvider;
  model?: string;
  apply: boolean;
  collectorUrl: string;
  apiKey: string;
}

export async function runFix(options: FixCliOptions): Promise<{
  applied: boolean;
  diff: string;
  regressionSha?: string;
  parentSha?: string;
}> {
  const onProgress = (event: FixProgress): void => {
    process.stderr.write(progressLine(event) + "\n");
  };

  // Validate source: exactly one of (sourceDir | gitUrl).
  const hasPath = !!options.sourceDir;
  const hasGit = !!options.gitUrl;
  if (hasPath && hasGit) {
    throw new Error("Cannot combine --source-dir with --git-url. Pick one.");
  }
  if (!hasPath && !hasGit) {
    throw new Error("One of --source-dir or --git-url is required.");
  }
  if (hasGit && !options.token) {
    throw new Error("--git-url requires --token (BYOG read-only token).");
  }

  // Validate bisect combination.
  if (options.bisect) {
    if (!options.from || !options.to) {
      throw new Error("--bisect requires both --from and --to SHAs.");
    }
    if (!hasGit) {
      throw new Error("--bisect requires --git-url (a git source).");
    }
  }

  const source: Source = hasGit
    ? { kind: "git", repoUrl: options.gitUrl!, token: options.token!, ref: options.ref }
    : { kind: "path", dir: resolve(options.sourceDir!) };

  const mode: FixMode = options.bisect
    ? { kind: "bisect", from: options.from!, to: options.to! }
    : { kind: "span" };

  const result = await fix({
    traceId: options.traceId,
    collectorUrl: options.collectorUrl,
    source,
    llm: {
      provider: options.provider,
      apiKey: options.apiKey,
      model: options.model,
    },
    mode,
    onProgress,
  });

  process.stdout.write(result.diff + (result.diff.endsWith("\n") ? "" : "\n"));
  process.stderr.write(`\n# Explanation\n${result.explanation}\n`);
  if (result.filesChanged.length > 0) {
    process.stderr.write(`# Files changed: ${result.filesChanged.join(", ")}\n`);
  }
  if (result.regressionSha) {
    process.stderr.write(
      `# Bisect: regression introduced at ${result.regressionSha.slice(0, 12)}` +
        (result.parentSha ? ` (parent: ${result.parentSha.slice(0, 12)})` : "") +
        "\n",
    );
  }

  const baseResult = {
    applied: false,
    diff: result.diff,
    regressionSha: result.regressionSha,
    parentSha: result.parentSha,
  };

  if (!options.apply) {
    return baseResult;
  }
  if (result.diff.trim().length === 0) {
    process.stderr.write("# --apply skipped: engine returned an empty diff\n");
    return baseResult;
  }
  // --apply is path-mode only. Git mode leaves only the tempdir, which is
  // cleaned up by the engine, so there's nowhere to apply to.
  if (!options.sourceDir) {
    process.stderr.write("# --apply skipped: git mode has no local working tree\n");
    return baseResult;
  }

  await applyDiff(result.diff, resolve(options.sourceDir));
  process.stderr.write("# Applied to working tree.\n");
  return { ...baseResult, applied: true };
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
