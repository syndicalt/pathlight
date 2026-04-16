#!/usr/bin/env node

import { existsSync, renameSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const shouldDelete = args.includes("--delete");

const raw = process.env.DATABASE_URL || "file:pathlight.db";
const filePath = raw.startsWith("file:") ? raw.slice(5) : raw;

if (filePath.startsWith("libsql://") || filePath.startsWith("http")) {
  console.error("Error: db:retire only works with local SQLite files, not remote databases.");
  process.exit(1);
}

const resolved = resolve(filePath);

if (!existsSync(resolved)) {
  console.error(`No database found at ${resolved}`);
  process.exit(1);
}

if (shouldDelete) {
  unlinkSync(resolved);
  console.log(`Deleted: ${resolved}`);
} else {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archived = resolved.replace(/\.db$/, `.archived-${timestamp}.db`);
  renameSync(resolved, archived);
  console.log(`Archived: ${resolved} -> ${archived}`);
}
