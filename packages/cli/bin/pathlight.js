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
  const fixOptionNames = [
    "--source-dir", "--provider", "--model", "--collector-url",
    "--git-url", "--ref", "--from", "--to",
  ];
  const traceIdArgs = args.filter((a) => !a.startsWith("--") && !isOptionValue(args, a, fixOptionNames));
  const traceId = traceIdArgs[0];
  if (!traceId || askedForHelp) {
    console.log(
      "Usage: pathlight fix <trace-id> [options]\n\n" +
      "Source (pick one):\n" +
      "  --source-dir <path>    Local source directory (default: cwd if no --git-url)\n" +
      "  --git-url <url>        Remote git repo (http/https). Requires PATHLIGHT_GIT_TOKEN.\n" +
      "  --ref <ref>            Git branch/tag to check out (default: HEAD)\n\n" +
      "Bisect:\n" +
      "  --bisect               Binary-search commit range for the regression\n" +
      "  --from <sha>           Known-good SHA (older). Required with --bisect.\n" +
      "  --to <sha>             Known-bad SHA (newer). Required with --bisect.\n\n" +
      "Other:\n" +
      "  --provider <name>      LLM provider: anthropic | openai (default: anthropic)\n" +
      "  --model <id>           Override the default model for the chosen provider\n" +
      "  --collector-url <url>  Collector URL (default: $PATHLIGHT_URL or http://localhost:4100)\n" +
      "  --apply                Apply the diff to the working tree via `git apply` (path mode only)\n\n" +
      "Environment:\n" +
      "  PATHLIGHT_LLM_API_KEY  Required. API key for the chosen provider (BYOK).\n" +
      "  PATHLIGHT_GIT_TOKEN    Required with --git-url. Read-only token (PAT).",
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

  const gitUrl = getOpt(args, "--git-url");
  const token = process.env.PATHLIGHT_GIT_TOKEN;
  // Default sourceDir only when no gitUrl — keeps the old default behavior.
  const sourceDirOpt = getOpt(args, "--source-dir");
  const sourceDir = gitUrl ? sourceDirOpt : (sourceDirOpt || process.cwd());
  const collectorUrl = getOpt(args, "--collector-url") || process.env.PATHLIGHT_URL || "http://localhost:4100";
  const bisect = args.includes("--bisect");

  if (gitUrl && !token) {
    console.error("--git-url requires PATHLIGHT_GIT_TOKEN to be exported (read-only PAT).");
    process.exit(2);
  }

  try {
    await runFix({
      traceId,
      sourceDir,
      gitUrl,
      token,
      ref: getOpt(args, "--ref"),
      bisect,
      from: getOpt(args, "--from"),
      to: getOpt(args, "--to"),
      provider,
      model: getOpt(args, "--model"),
      collectorUrl,
      apiKey,
      apply: args.includes("--apply"),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(scrubCliMessage(message, token));
    process.exit(2);
  }
}

/** Final-line defense: scrub the token from any CLI error message. */
function scrubCliMessage(message, token) {
  if (!token) return message;
  return message.split(token).join("[REDACTED]");
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
