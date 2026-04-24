import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { FixError, type GitSource } from "../types.js";
import { createManagedTempdir, type ManagedTempdir } from "./tempdir.js";
import type { SourceReader, FileContent } from "./path.js";

/**
 * Build a clone URL that carries the token for HTTPS basic-auth.
 *
 * Security:
 * - The token is embedded in memory only, never logged, never returned
 *   from this adapter. Callers must NEVER pass the adapter object through
 *   a formatter that might call toString on it.
 * - If the URL can't be parsed, we return a scrub-safe error that never
 *   echoes the token.
 */
export function buildAuthenticatedUrl(repoUrl: string, token: string): string {
  let url: URL;
  try {
    url = new URL(repoUrl);
  } catch {
    throw new FixError(`Invalid git repoUrl: not a valid URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new FixError(
      `Git source requires an http(s) URL (got ${url.protocol}). SSH and other schemes are not supported in v1.`,
    );
  }
  // Use x-access-token convention (works for GitHub PAT, fine-grained tokens,
  // and most other hosts that accept token-as-password basic auth).
  url.username = "x-access-token";
  url.password = token;
  return url.toString();
}

/**
 * Sanitize an error message so it can never contain the token.
 * Also scrubs any accidental occurrence of `x-access-token:<token>@`.
 */
export function scrubToken(message: string, token: string): string {
  if (!token) return message;
  let out = message.split(token).join("[REDACTED]");
  // Also cover the basic-auth shape in case only a prefix leaked.
  out = out.replace(/x-access-token:[^@\s]+@/g, "x-access-token:[REDACTED]@");
  return out;
}

interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runGit(args: string[], cwd: string | undefined, token: string): Promise<SpawnResult> {
  return new Promise((resolvePromise) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // Silence any git credential prompt — fail loud instead of hang.
        GIT_TERMINAL_PROMPT: "0",
        // Don't let the user's gitconfig inject a credential helper that
        // could persist the token.
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf-8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf-8")));
    child.on("error", (err) => {
      resolvePromise({
        code: -1,
        stdout,
        stderr: scrubToken(stderr + (stderr && err.message ? "\n" : "") + (err.message ?? ""), token),
      });
    });
    child.on("exit", (code) => {
      resolvePromise({
        code: code ?? -1,
        stdout,
        stderr: scrubToken(stderr, token),
      });
    });
  });
}

export interface GitSourceReader extends SourceReader {
  /** Exposed so bisect can deepen history when needed. */
  readonly repoDir: string;
  fetchDepth(depth: number): Promise<void>;
  fetchFull(): Promise<void>;
  checkout(ref: string): Promise<void>;
}

export interface CreateGitSourceReaderOptions {
  /** Initial clone depth. `0` means full clone. Default: 1 (shallow). */
  depth?: number;
}

/**
 * Clone `source.repoUrl` into a managed tempdir, check out `source.ref`,
 * return a reader with the same interface as PathSource + a few git-specific
 * helpers the bisect engine uses to walk history.
 */
export async function createGitSourceReader(
  source: GitSource,
  options: CreateGitSourceReaderOptions = {},
): Promise<GitSourceReader> {
  const token = source.token;
  const depth = options.depth ?? 1;

  if (!token || typeof token !== "string") {
    throw new FixError("GitSource requires a non-empty token");
  }

  const managed: ManagedTempdir = createManagedTempdir();
  const repoDir = managed.path;
  const authedUrl = buildAuthenticatedUrl(source.repoUrl, token);

  const cloneArgs = ["clone", "--quiet"];
  if (depth > 0) cloneArgs.push("--depth", String(depth));
  if (source.ref) cloneArgs.push("--branch", source.ref);
  cloneArgs.push(authedUrl, repoDir);

  const cloneRes = await runGit(cloneArgs, undefined, token);
  if (cloneRes.code !== 0) {
    await managed.release();
    // Use a generic message — stderr from git can include retry URLs that
    // might echo parts of the auth header on some hosts. scrubToken helps
    // but we don't inline stderr at all for the primary failure message.
    throw new FixError(
      `git clone failed (exit ${cloneRes.code}). Check that the repoUrl is correct, the token has read access, and the ref exists.`,
    );
  }

  async function resolveScoped(relPath: string): Promise<string> {
    const absolute = resolve(repoDir, relPath);
    const rel = relative(repoDir, absolute);
    if (rel.startsWith("..") || rel.startsWith(sep)) {
      throw new FixError(`Path escapes source root: ${relPath}`);
    }
    return absolute;
  }

  const reader: GitSourceReader = {
    rootDir: repoDir,
    repoDir,
    async readFile(relPath: string) {
      const abs = await resolveScoped(relPath);
      try {
        return await readFile(abs, "utf-8");
      } catch (err) {
        throw new FixError(`Failed to read ${relPath}`, err);
      }
    },
    async readFiles(relPaths: string[]): Promise<FileContent[]> {
      return Promise.all(
        relPaths.map(async (p) => ({ path: p, content: await reader.readFile(p) })),
      );
    },
    async cleanup() {
      await managed.release();
    },
    async fetchDepth(newDepth: number) {
      const res = await runGit(
        ["fetch", "--quiet", "--depth", String(newDepth), "origin"],
        repoDir,
        token,
      );
      if (res.code !== 0) {
        throw new FixError(`git fetch --depth ${newDepth} failed (exit ${res.code})`);
      }
    },
    async fetchFull() {
      const res = await runGit(
        ["fetch", "--quiet", "--unshallow", "origin"],
        repoDir,
        token,
      );
      if (res.code !== 0) {
        // If the clone was already full, --unshallow errors; fall back to a
        // plain fetch which is idempotent.
        const retry = await runGit(["fetch", "--quiet", "origin"], repoDir, token);
        if (retry.code !== 0) {
          throw new FixError(`git fetch --unshallow failed (exit ${res.code})`);
        }
      }
    },
    async checkout(ref: string) {
      const res = await runGit(["checkout", "--quiet", ref], repoDir, token);
      if (res.code !== 0) {
        throw new FixError(`git checkout ${ref} failed (exit ${res.code})`);
      }
    },
  };

  return reader;
}
