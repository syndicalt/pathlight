#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  exportComfyHistoryToPathlight,
  fetchComfyHistory,
  type ComfyHistoryEnvelope,
  type ComfyHistoryItem,
} from "./index.js";

interface CliOptions {
  collectorUrl: string;
  comfyUrl: string;
  promptId?: string;
  historyFile?: string;
  apiKey?: string;
  traceName?: string;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const history = options.historyFile
    ? JSON.parse(await readFile(options.historyFile, "utf8")) as ComfyHistoryEnvelope | ComfyHistoryItem
    : await fetchComfyHistory(options.comfyUrl, required(options.promptId, "--prompt-id is required without --history-file"));

  const result = await exportComfyHistoryToPathlight(history, {
    collectorUrl: options.collectorUrl,
    apiKey: options.apiKey,
    promptId: options.promptId,
    traceName: options.traceName,
  });

  console.log(JSON.stringify({
    traceId: result.traceId,
    spanCount: result.spanIds.length,
    status: result.plan.status,
    error: result.plan.error,
  }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    collectorUrl: process.env.PATHLIGHT_COLLECTOR_URL ?? "http://localhost:4100",
    comfyUrl: process.env.COMFYUI_URL ?? "http://127.0.0.1:8188",
    apiKey: process.env.PATHLIGHT_API_KEY,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => required(args[++index], `${arg} requires a value`);
    if (arg === "--collector-url") options.collectorUrl = next();
    else if (arg === "--comfy-url") options.comfyUrl = next();
    else if (arg === "--prompt-id") options.promptId = next();
    else if (arg === "--history-file") options.historyFile = next();
    else if (arg === "--api-key") options.apiKey = next();
    else if (arg === "--trace-name") options.traceName = next();
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined || value === "") throw new Error(message);
  return value;
}

function printHelp() {
  console.log(`pathlight-comfyui

Export a ComfyUI history item into Pathlight.

Usage:
  pathlight-comfyui --prompt-id <id> [--comfy-url http://127.0.0.1:8188] [--collector-url http://localhost:4100]
  pathlight-comfyui --history-file history.json [--collector-url http://localhost:4100]

Environment:
  COMFYUI_URL
  PATHLIGHT_COLLECTOR_URL
  PATHLIGHT_API_KEY
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
