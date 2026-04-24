import { spawn } from "node:child_process";
import { FixError } from "./types.js";
import type { GitSourceReader } from "./source/git.js";

/**
 * Status of a commit under the probe: does the failure reproduce?
 *
 * - "good" — probed SHA does NOT reproduce the failure (pre-regression).
 * - "bad"  — probed SHA DOES reproduce the failure.
 * - "skip" — probed SHA is indeterminate (build broken, test flaky, etc.);
 *   bisect skips and narrows from the adjacent side.
 */
export type ProbeVerdict = "good" | "bad" | "skip";

export interface BisectProbe {
  (sha: string): Promise<ProbeVerdict>;
}

export interface BisectOptions {
  /** Known-good SHA (older — failure does NOT reproduce here). */
  from: string;
  /** Known-bad SHA (newer — failure DOES reproduce here). */
  to: string;
  /**
   * Called once per candidate SHA. Must return "good" / "bad" / "skip".
   * The bisect engine does O(log n) calls on average.
   */
  probe: BisectProbe;
  /** Optional progress callback, fired on every iteration + on final result. */
  onIteration?: (event: { sha: string; depth: number; verdict: ProbeVerdict }) => void;
  /** Upper bound on probe calls — defensive cap if history is pathological. */
  maxIterations?: number;
}

export interface BisectResult {
  /** First commit where the failure reproduces (the regression introducer). */
  regressionSha: string;
  /** Parent of `regressionSha` — last known good. */
  parentSha: string;
  /** All SHAs considered, in walk order. */
  walked: string[];
  /** Number of probe() calls actually made. */
  iterations: number;
}

interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runGit(args: string[], cwd: string): Promise<SpawnResult> {
  return new Promise((resolvePromise) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf-8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf-8")));
    child.on("error", (err) =>
      resolvePromise({ code: -1, stdout, stderr: stderr + (err.message ?? "") }),
    );
    child.on("exit", (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
  });
}

/**
 * Return the linear list of commits from `from` (exclusive) to `to` (inclusive),
 * oldest → newest. Uses `git rev-list --reverse from..to` so the output order
 * is the natural bisect order.
 */
export async function listCommitRange(
  repoDir: string,
  from: string,
  to: string,
): Promise<string[]> {
  const res = await runGit(["rev-list", "--reverse", `${from}..${to}`], repoDir);
  if (res.code !== 0) {
    throw new FixError(
      `git rev-list ${from}..${to} failed (exit ${res.code}): ${res.stderr.trim()}`,
    );
  }
  return res.stdout.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Return the parent SHA of `sha`, or null if `sha` is a root commit. */
export async function parentOf(repoDir: string, sha: string): Promise<string | null> {
  const res = await runGit(["rev-parse", `${sha}^`], repoDir);
  if (res.code !== 0) return null;
  return res.stdout.trim() || null;
}

/**
 * Binary-search the `from..to` commit range for the first commit where
 * `probe()` returns "bad". Invariants going in:
 *   - probe(from) is expected to be "good" (verified in the first two calls)
 *   - probe(to)   is expected to be "bad"
 *
 * Complexity: O(log₂(N)) probe calls for N = commits in range.
 *
 * Algorithm (classic lower-bound search):
 *   - Keep `lo` pointing at the last known-good index, `hi` at the first
 *     known-bad index.
 *   - Pick `mid`, probe. If "bad", hi = mid. If "good", lo = mid.
 *   - "skip" verdicts narrow from the adjacent known side by walking the
 *     midpoint one step at a time until it's decidable or the range collapses.
 */
export async function bisect(
  repoDir: string,
  options: BisectOptions,
): Promise<BisectResult> {
  const commits = await listCommitRange(repoDir, options.from, options.to);
  if (commits.length === 0) {
    throw new FixError(
      `Empty commit range ${options.from}..${options.to} — nothing to bisect.`,
    );
  }

  // Validate endpoints: `to` must be "bad", `from` must be "good".
  // These two verified probes are charged against the iteration budget.
  const walked: string[] = [];
  let iterations = 0;
  const maxIter = options.maxIterations ?? 64;

  const emit = (sha: string, depth: number, verdict: ProbeVerdict): void => {
    walked.push(sha);
    try {
      options.onIteration?.({ sha, depth, verdict });
    } catch {
      // progress must not break bisect
    }
  };

  // Probe `to`.
  iterations += 1;
  const toVerdict = await options.probe(options.to);
  emit(options.to, 0, toVerdict);
  if (toVerdict !== "bad") {
    throw new FixError(
      `Bisect endpoint ${options.to} did not reproduce the failure (got "${toVerdict}"). ` +
        `The --to commit must be known-bad.`,
    );
  }

  // Probe `from`.
  iterations += 1;
  const fromVerdict = await options.probe(options.from);
  emit(options.from, 0, fromVerdict);
  if (fromVerdict === "bad") {
    throw new FixError(
      `Bisect endpoint ${options.from} already reproduces the failure. ` +
        `The --from commit must be known-good.`,
    );
  }

  // lo = last good index (virtual -1 meaning "before commits[0]"; `from` sits
  // logically before `commits[0]` because rev-list from..to is exclusive of
  // `from`). hi = first bad index (commits.length-1 = `to`).
  let lo = -1;
  let hi = commits.length - 1;

  while (hi - lo > 1) {
    if (iterations >= maxIter) {
      throw new FixError(
        `Bisect exceeded maxIterations (${maxIter}). Range may be pathological.`,
      );
    }
    const mid = Math.floor((lo + hi) / 2);
    const sha = commits[mid]!;
    iterations += 1;
    const verdict = await options.probe(sha);
    const depth = iterations;
    emit(sha, depth, verdict);

    if (verdict === "bad") {
      hi = mid;
    } else if (verdict === "good") {
      lo = mid;
    } else {
      // "skip": try the next candidate. Prefer moving toward hi so we always
      // terminate (mid+1 is either decidable or === hi and the loop exits).
      if (mid + 1 < hi) {
        // try the next-newer commit on the next iteration — emulate by
        // narrowing lo to just below mid, so the next `Math.floor` picks
        // a different midpoint. If that fails too, the loop continues.
        lo = mid;
      } else if (mid - 1 > lo) {
        hi = mid;
      } else {
        // Range collapsed around a single skip-verdict commit; treat as bad
        // to make progress (documented behavior).
        hi = mid;
      }
    }
  }

  const regressionSha = commits[hi]!;
  const parentIndex = hi - 1;
  const parentSha =
    parentIndex >= 0 ? commits[parentIndex]! : options.from;

  return {
    regressionSha,
    parentSha,
    walked,
    iterations,
  };
}

/**
 * Build a probe that uses the fix engine itself at a given SHA:
 * - checks out the SHA in the GitSourceReader
 * - re-runs fix() in span mode against the failing trace
 * - if the engine identifies the same failure signal, verdict = "bad"
 *
 * This is the default bisect probe. Callers can supply their own probe
 * (e.g. backed by `pathlight-eval`) for assertion-based bisect.
 */
export function makeGitCheckoutProbe(
  reader: GitSourceReader,
  evaluate: () => Promise<ProbeVerdict>,
): BisectProbe {
  return async (sha: string) => {
    // Deepen history if the shallow clone doesn't include this SHA.
    // We try checkout first; if it fails with "unknown revision" we fall
    // back to a full fetch and retry once.
    try {
      await reader.checkout(sha);
    } catch {
      await reader.fetchFull();
      await reader.checkout(sha);
    }
    return evaluate();
  };
}
