import { mkdtempSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Tempdir lifecycle for git-mode source reads.
 *
 * Contract:
 * - Every `fix()` that opens a GitSource MUST call `createManagedTempdir()` and
 *   release it in a `finally` block via `release()`.
 * - Prefix is fixed (`pathlight-fix-`) so the sweeper can find orphans without
 *   confusing them with unrelated temp dirs.
 * - A process-exit hook best-effort sweeps any dirs that outlived their owner
 *   (shutdown before `finally`, SIGKILL on parent process, etc.). We DO NOT
 *   block process exit — sweep is synchronous but bounded.
 */

export const TEMPDIR_PREFIX = "pathlight-fix-";

/** Max age of a pathlight tempdir before the periodic sweeper reclaims it. */
export const STALE_AGE_MS = 60 * 60 * 1000; // 1 hour

/** Dirs owned by the current process. Cleared as `release()` runs. */
const registered = new Set<string>();

let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // Best-effort cleanup on process exit. Must be synchronous (exit is sync).
  // Never throws — a failing cleanup shouldn't break shutdown.
  process.on("exit", () => {
    for (const dir of registered) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore — best effort
      }
    }
    registered.clear();
  });
}

export interface ManagedTempdir {
  /** Absolute path to the tempdir. */
  path: string;
  /**
   * Remove the dir and deregister it. Idempotent and never throws.
   * Call this in `finally` after any work that created the dir.
   */
  release(): Promise<void>;
}

/** Create a process-owned tempdir with the pathlight prefix. */
export function createManagedTempdir(): ManagedTempdir {
  installExitHook();
  const path = mkdtempSync(join(tmpdir(), TEMPDIR_PREFIX));
  registered.add(path);
  return {
    path,
    async release() {
      if (!registered.has(path)) return;
      registered.delete(path);
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // ignore — best effort
      }
    },
  };
}

/**
 * Sweep `os.tmpdir()` for orphaned pathlight tempdirs older than `maxAgeMs`.
 * Called opportunistically from `createManagedTempdir` callers or explicitly.
 * Returns the list of paths that were removed.
 */
export function sweepStaleTempdirs(maxAgeMs: number = STALE_AGE_MS): string[] {
  const removed: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(tmpdir());
  } catch {
    return removed;
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const entry of entries) {
    if (!entry.startsWith(TEMPDIR_PREFIX)) continue;
    const full = join(tmpdir(), entry);
    try {
      const stat = statSync(full);
      if (!stat.isDirectory()) continue;
      if (stat.mtimeMs > cutoff) continue;
      rmSync(full, { recursive: true, force: true });
      removed.push(full);
    } catch {
      // ignore — best effort
    }
  }
  return removed;
}

/** Test helper — exposes the registered set size. Not part of the public API. */
export function _registeredCount(): number {
  return registered.size;
}
