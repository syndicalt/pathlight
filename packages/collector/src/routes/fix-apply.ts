/**
 * `POST /v1/fix-apply` — writes a diff to the caller's local working tree
 * via `git apply`. Self-hosted trust model applies (parent invariant #4:
 * auth is deferred). The route runs `git apply --check` first and only
 * writes if the dry run succeeds.
 *
 * IMPORTANT: this route executes a single hard-coded command (`git apply`)
 * with a user-supplied `sourceDir` as cwd and a user-supplied diff on stdin.
 * It does NOT evaluate any other command. Trust boundary is the self-hosted
 * collector == the dev tree; in a hosted deployment this route should be
 * disabled via an operator flag.
 */

import { Hono } from "hono";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

interface ApplyBody {
  sourceDir?: unknown;
  diff?: unknown;
}

export function createFixApplyRoutes() {
  const app = new Hono();

  app.post("/", async (c) => {
    let body: ApplyBody;
    try {
      body = await c.req.json<ApplyBody>();
    } catch {
      return c.json({ error: { message: "invalid json body", type: "validation_error" } }, 400);
    }

    if (typeof body.sourceDir !== "string" || body.sourceDir.length === 0) {
      return c.json({ error: { message: "sourceDir required", type: "validation_error" } }, 400);
    }
    if (typeof body.diff !== "string" || body.diff.length === 0) {
      return c.json({ error: { message: "diff required", type: "validation_error" } }, 400);
    }

    const cwd = resolve(body.sourceDir);
    const diff = body.diff;

    try {
      await runGitApply(["apply", "--check", "--whitespace=nowarn", "-"], cwd, diff);
    } catch (err) {
      return c.json(
        {
          error: {
            message: "diff failed git apply --check",
            type: "apply_precheck_failed",
            detail: err instanceof Error ? err.message : String(err),
          },
        },
        409,
      );
    }

    try {
      await runGitApply(["apply", "--whitespace=nowarn", "-"], cwd, diff);
    } catch (err) {
      return c.json(
        {
          error: {
            message: "git apply failed after passing --check",
            type: "apply_failed",
            detail: err instanceof Error ? err.message : String(err),
          },
        },
        500,
      );
    }

    return c.json({ applied: true });
  });

  return app;
}

function runGitApply(args: string[], cwd: string, stdin: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["pipe", "ignore", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });

    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf-8");
    });
    child.on("error", (err) => rejectPromise(err));
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(stderr.trim() || `git apply exited with code ${code ?? "unknown"}`));
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
}
