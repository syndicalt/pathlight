#!/usr/bin/env node
// @pathlight/eval CLI — loads a spec file and runs it against recent traces.
//
// Usage:
//   pathlight-eval <spec-file> [--base-url http://localhost:4100]
//
// The spec file is a plain ES module (.js or .mjs) that exports default a
// function, or that calls evaluate(...) directly. Examples:
//
//   // spec-default-export.mjs
//   import { expect, evaluate } from "@pathlight/eval";
//   export default () => evaluate(
//     { baseUrl: "http://localhost:4100", name: "estimate", limit: 20 },
//     (t) => {
//       expect(t).toSucceed();
//       expect(t).toCompleteWithin("10s");
//     }
//   );

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log("Usage: pathlight-eval <spec-file> [--base-url <url>]");
  process.exit(args.length === 0 ? 1 : 0);
}

const specPath = args[0];
const baseUrlIdx = args.indexOf("--base-url");
const baseUrl = baseUrlIdx >= 0 ? args[baseUrlIdx + 1] : process.env.PATHLIGHT_URL || "http://localhost:4100";

process.env.PATHLIGHT_URL = baseUrl;

const abs = resolve(process.cwd(), specPath);
let mod;
try {
  mod = await import(pathToFileURL(abs).href);
} catch (err) {
  console.error(`Failed to load spec file ${abs}:`);
  console.error(err);
  process.exit(2);
}

const runner = typeof mod.default === "function" ? mod.default : null;
if (!runner) {
  console.error("Spec file must export default a function returning an EvalResult.");
  process.exit(2);
}

const start = Date.now();
let result;
try {
  result = await runner();
} catch (err) {
  console.error("Spec file threw before returning a result:");
  console.error(err);
  process.exit(2);
}

if (!result || typeof result.passed !== "number") {
  console.error("Spec did not return an EvalResult (did you return the evaluate() promise?)");
  process.exit(2);
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);

console.log("");
console.log(`Pathlight eval — ${result.total} trace${result.total === 1 ? "" : "s"} checked in ${elapsed}s`);
console.log(`  Passed: ${result.passed}`);
console.log(`  Failed: ${result.failed}`);

if (result.failures.length > 0) {
  console.log("");
  console.log("Failures:");
  for (const f of result.failures) {
    console.log(`  - [${f.traceId.slice(0, 10)}] ${f.rule}: ${f.message}`);
  }
  process.exit(1);
}

process.exit(0);
