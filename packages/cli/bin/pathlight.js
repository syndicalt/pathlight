#!/usr/bin/env node
// Pathlight CLI — subcommand router.
//
// Commands:
//   pathlight share <trace-id> [options]
//   pathlight fix   <trace-id> [options]

import { runShare } from "../dist/commands/share.js";
import { runFix } from "../dist/commands/fix.js";

function usage() {
  console.log(
    "Usage: pathlight <command> [...args]\n\n" +
    "Commands:\n" +
    "  share <trace-id>     Export a single-file HTML snapshot of a trace\n" +
    "  fix   <trace-id>     Propose a code diff that fixes the failing trace\n\n" +
    "Run `pathlight <command> --help` for command-specific help.",
  );
}

const [, , command, ...rest] = process.argv;

if (!command || command === "--help" || command === "-h") {
  usage();
  process.exit(command ? 0 : 1);
}

if (command === "share") {
  await handleShare(rest);
} else if (command === "fix") {
  await handleFix(rest);
} else {
  console.error(`Unknown command: ${command}`);
  usage();
  process.exit(1);
}

async function handleShare(args) {
  const askedForHelp = args.includes("--help") || args.includes("-h");
  const shareOptionNames = ["--base-url", "--out"];
  const traceIdArgs = args.filter((a) => !a.startsWith("--") && !isOptionValue(args, a, shareOptionNames));
  const traceId = traceIdArgs[0];
  if (!traceId || askedForHelp) {
    console.log(
      "Usage: pathlight share <trace-id> [options]\n\n" +
      "Options:\n" +
      "  --base-url <url>    Collector URL (default: $PATHLIGHT_URL or http://localhost:4100)\n" +
      "  --out <path>        Output HTML path\n" +
      "  --redact-input      Redact input / toolArgs\n" +
      "  --redact-output     Redact output / toolResult\n" +
      "  --redact-errors     Redact error messages",
    );
    process.exit(askedForHelp ? 0 : 1);
  }
  const baseUrl = getOpt(args, "--base-url") || process.env.PATHLIGHT_URL || "http://localhost:4100";
  const out = getOpt(args, "--out");
  try {
    const path = await runShare({
      traceId,
      baseUrl,
      output: out,
      redactInput: args.includes("--redact-input"),
      redactOutput: args.includes("--redact-output"),
      redactErrors: args.includes("--redact-errors"),
    });
    console.log(`Wrote ${path}`);
    console.log("Open it directly in a browser — no server needed.");
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

async function handleFix(args) {
  const askedForHelp = args.includes("--help") || args.includes("-h");
  const fixOptionNames = ["--source-dir", "--provider", "--model", "--collector-url"];
  const traceIdArgs = args.filter((a) => !a.startsWith("--") && !isOptionValue(args, a, fixOptionNames));
  const traceId = traceIdArgs[0];
  if (!traceId || askedForHelp) {
    console.log(
      "Usage: pathlight fix <trace-id> [options]\n\n" +
      "Options:\n" +
      "  --source-dir <path>    Local source directory (default: cwd)\n" +
      "  --provider <name>      LLM provider: anthropic | openai (default: anthropic)\n" +
      "  --model <id>           Override the default model for the chosen provider\n" +
      "  --collector-url <url>  Collector URL (default: $PATHLIGHT_URL or http://localhost:4100)\n" +
      "  --apply                Apply the diff to the working tree via `git apply`\n\n" +
      "Environment:\n" +
      "  PATHLIGHT_LLM_API_KEY  Required. API key for the chosen provider (BYOK).",
    );
    process.exit(askedForHelp ? 0 : 1);
  }

  const apiKey = process.env.PATHLIGHT_LLM_API_KEY;
  if (!apiKey) {
    console.error("PATHLIGHT_LLM_API_KEY is required. Export it with your provider's API key.");
    process.exit(2);
  }

  const provider = (getOpt(args, "--provider") || "anthropic").toLowerCase();
  if (provider !== "anthropic" && provider !== "openai") {
    console.error(`--provider must be 'anthropic' or 'openai' (got: ${provider})`);
    process.exit(2);
  }

  const sourceDir = getOpt(args, "--source-dir") || process.cwd();
  const collectorUrl = getOpt(args, "--collector-url") || process.env.PATHLIGHT_URL || "http://localhost:4100";

  try {
    await runFix({
      traceId,
      sourceDir,
      provider,
      model: getOpt(args, "--model"),
      collectorUrl,
      apiKey,
      apply: args.includes("--apply"),
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

function getOpt(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
function isOptionValue(args, value, optionNames) {
  const i = args.indexOf(value);
  if (i <= 0) return false;
  return optionNames.includes(args[i - 1]);
}
