import { readFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { FixError, type PathSource } from "../types.js";

export interface FileContent {
  path: string;
  content: string;
}

export interface SourceReader {
  /** Absolute root of the source tree the engine is allowed to read. */
  rootDir: string;
  readFile(relPath: string): Promise<string>;
  readFiles(relPaths: string[]): Promise<FileContent[]>;
  cleanup(): Promise<void>;
}

export function createPathSourceReader(source: PathSource): SourceReader {
  const rootDir = resolve(source.dir);

  function resolveScoped(relPath: string): string {
    const absolute = resolve(rootDir, relPath);
    const rel = relative(rootDir, absolute);
    if (rel.startsWith("..") || rel.startsWith(sep) || rel === "") {
      if (rel === "") return absolute;
      throw new FixError(`Path escapes source root: ${relPath}`);
    }
    return absolute;
  }

  return {
    rootDir,
    async readFile(relPath) {
      const abs = resolveScoped(relPath);
      try {
        return await readFile(abs, "utf-8");
      } catch (err) {
        throw new FixError(`Failed to read ${relPath}`, err);
      }
    },
    async readFiles(relPaths) {
      return Promise.all(
        relPaths.map(async (p) => ({ path: p, content: await this.readFile(p) })),
      );
    },
    async cleanup() {
      // no-op for path mode
    },
  };
}
