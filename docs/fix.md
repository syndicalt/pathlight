# Code-fixing agent

Pathlight reads a failing trace and proposes a diff that fixes the root cause — BYOK (your own LLM key, your own LLM traffic) and git-provenance-aware (bisect across commits to pin regressions to a specific SHA).

Three surfaces over one core:

- **Library** — `@pathlight/fix` exports a pure `fix()` function.
- **CLI** — `pathlight fix <trace-id>` for headless / CI use.
- **Dashboard** — "Fix this" button on every failed span, streaming diff preview, one-click apply.

## Quick start — CLI

```bash
# Path mode (local source tree)
export PATHLIGHT_LLM_API_KEY=sk-ant-...
pathlight fix trc_xxx --source-dir . --apply

# Git mode (remote clone, read-only)
export PATHLIGHT_LLM_API_KEY=sk-...
export PATHLIGHT_GIT_TOKEN=ghp_...
pathlight fix trc_xxx --git-url https://github.com/acme/repo.git --provider openai

# Bisect — find the regression commit across a SHA range
pathlight fix trc_xxx \
  --bisect --from <good-sha> --to <bad-sha> \
  --git-url https://github.com/acme/repo.git
```

Progress prints to stderr (`# fetching trace`, `# calling anthropic claude-opus-4-7`, `# bisect depth 2 at abc1234`); the diff writes to stdout so you can pipe:

```bash
pathlight fix trc_xxx > /tmp/fix.patch
git checkout -b fix/trc_xxx
git apply /tmp/fix.patch
```

## Try it without writing your own bug

The repo ships a re-runnable seed that creates the data the dashboard "Fix this"
flow needs (a project, a failing trace with `_source.file`-tagged spans, and
the matching demo source files):

```bash
# 1. Run a Pathlight stack with BYOK enabled
echo "PATHLIGHT_SEAL_KEY=$(node -e 'console.log(require(\"crypto\").randomBytes(32).toString(\"base64\"))')" >> .env
docker compose down && docker compose up -d

# 2. Seed the demo data
node scripts/seed-screenshots.mjs
# Outputs:
#   ✓ Project ready (id: <abc>)
#   ✓ Fix-engine demo trace:  <fixTraceId>
#   ✓ OpenClaw demo trace:    <ocTraceId>
#   ✓ BYOK keys seeded:       3

# 3. Add your real Anthropic key
#    Open http://localhost:3100/settings/keys
#    Paste the printed Project ID, then add a key with kind=llm provider=anthropic.

# 4. Open the failing trace, click the failed span, click "Fix this".
#    Source dir: $(pwd)/examples/quote-agent
#    API key: pick the one you just added
#    → SSE streams progress; diff renders red/green per file.
```

The seed leaves three "fake" sealed keys behind so the BYOK list shows real
variety even if you don't add a real one. The fake keys won't make a successful
LLM call (the engine returns `secret resolution failed`), but they make
`/settings/keys` look populated for screenshots and demos.

See [`scripts/seed-screenshots.mjs`](../scripts/seed-screenshots.mjs) for the
exact data shape.

## Quick start — Dashboard

1. Open a failing trace at http://localhost:3100.
2. Click any failed span. The inspector shows a **Fix this** button.
3. Dialog opens with the form:
   - Source mode: local path or git URL + token
   - Provider: Anthropic or OpenAI (with an empty-state link to `/settings/keys` if you have none)
   - Mode: span / trace / bisect
4. Submit. SSE progress streams live.
5. On result: diff preview renders with per-file expand/collapse, **Apply to working tree** (path mode), **Download .patch**, or **Copy**.

If the run used bisect, a banner above the diff shows the regression SHA and links to `/commits`.

## Quick start — Library

```typescript
import { fix } from "@pathlight/fix";

const result = await fix({
  traceId: "trc_xxx",
  collectorUrl: "http://localhost:4100",
  source: { kind: "path", dir: "/abs/path/to/repo" },
  llm: {
    provider: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY!,
    // model: "claude-opus-4-7",  // defaults per provider
  },
  mode: { kind: "span" },          // "span" | "trace" | "bisect"
  onProgress: (evt) => console.error(evt),
});

console.log(result.diff);          // unified diff, git-apply-ready
console.log(result.explanation);
console.log(result.filesChanged);
if (result.regressionSha) console.log("regression at", result.regressionSha);
```

## What it does

| Mode | Behavior |
| --- | --- |
| `span` | Fix the failing span(s) on the given trace. Default. |
| `trace` | Analyze the whole trace. Fix any failure found. |
| `bisect` | Walk a commit range, identify the regression commit via binary search, propose a fix against that SHA. Requires a git source. |

## Source access

- **Path mode** — engine reads files directly from `dir`. Reads are scoped: no `..` escapes allowed.
- **Git mode** — engine shallow-clones (`depth=1` by default; deepens automatically during bisect) into a temp dir, checks out `ref`, cleans up on exit. Read-only tokens only in v1 — no branch push, no PR creation.

## How file selection works

Every span the Pathlight SDK creates auto-attaches `metadata._source = { file, line, column, func }`. The fix engine reads those `_source.file` values off the failing spans, relativizes them against the source root, and sends only those files to the LLM. No directory crawl, no "please specify files" UX, no extra LLM round-trip.

For traces with no `_source` metadata (e.g. OTLP ingests), the prompt falls back to asking the LLM for file paths in its explanation. The engine returns an empty diff + a description of what's needed rather than guessing blindly.

## Bisect details

1. Validates `to` reproduces the failure and `from` does not — two endpoint probes.
2. Binary-searches the `from..to` commit range — O(log₂ N) probe calls for N commits.
3. Returns `{ regressionSha, parentSha, diff, explanation, ... }` where the diff is proposed against `regressionSha`.

Each probe does a fresh checkout in the tempdir and either re-runs the span-mode fix engine there or calls your custom `bisectProbe`. Shallow clones are deepened automatically if a probe SHA isn't in the current history.

Supply a custom probe (e.g. backed by `pathlight-eval` assertions):

```typescript
import { fix } from "@pathlight/fix";

await fix({
  // ...
  mode: { kind: "bisect", from: "abc123", to: "def456" },
  bisectProbe: async (sha) => {
    // your eval / test runner / heuristic
    const failed = await runEval(sha);
    return failed ? "bad" : "good";
  },
});
```

## BYOK invariants

These are enforced at every boundary — library, CLI, web API:

1. **Keys are never logged.** Not in `console.*`, not in errors, not in traces. The CLI scrubs any known token from its error path before printing.
2. **`FixError.cause` is non-enumerable** so default `JSON.stringify`/`console.error`/`util.inspect` cannot walk into SDK error payloads that might echo request headers.
3. **Every invocation emits a meta-trace** (`fix.engine`) to the Pathlight collector. The meta-trace carries mode, source kind, provider, model, token counts, and files-changed — but never the diff body, the explanation text, the API key, or the git token.
4. **Git tokens are read-only in v1.** No push, no PR creation. Extending to write requires auth work which is deferred.

See [packages/keys/LEAK-AUDIT.md](../packages/keys/LEAK-AUDIT.md) for the reusable audit checklist (applies to the BYOK key store; the engine follows the same rules).

## Providers

| Provider | Default model | Auth env |
| --- | --- | --- |
| Anthropic | `claude-opus-4-7` | `PATHLIGHT_LLM_API_KEY` (sk-ant-…) |
| OpenAI | `gpt-5.4` | `PATHLIGHT_LLM_API_KEY` (sk-…) |

Override with `--model <id>` or `llm.model`.

## Web API

The collector exposes the engine over SSE so the dashboard (and any other client) can drive it remotely:

| Endpoint | Method | Description |
| --- | --- | --- |
| `/v1/fix` | POST | Run the fix engine; response is `text/event-stream` with `progress`, `chunk`, `result`, `error`, `done` events |
| `/v1/fix-apply` | POST | Write a diff to a local working tree via `git apply`. Body: `{ sourceDir, diff }`. Runs `git apply --check` first. Restrict writable roots with `PATHLIGHT_FIX_APPLY_ROOTS`. |

The `/v1/fix` route resolves `keyId`/`tokenId` references (from [BYOK key storage](byok-keys.md)) internally and never accepts raw plaintext secrets from the wire.

`/v1/fix-apply` is intentionally local-trust: it writes to the filesystem of
the collector process. Leave `PATHLIGHT_FIX_APPLY_ROOTS` unset only for
personal local development. For shared machines, Docker deployments, or any
collector reachable from another browser, set it to a comma-separated list of
approved workspace roots:

```bash
PATHLIGHT_FIX_APPLY_ROOTS=/home/me/projects,/workspaces
```

Requests whose `sourceDir` resolves outside those roots are rejected before
Pathlight runs `git apply`.

## Troubleshooting

- **"Fix this" button is missing.** It only renders on spans with `status: failed`, `span.error` set, or output matching the suspicious-output heuristic (fail/failed/error/timeout/invalid/…). If your failure doesn't match, use the CLI.
- **Engine returned an empty diff.** Read the explanation — the model is telling you what context it needs. Re-run with a better source tree (e.g. the specific subdirectory) or pass a more targeted `mode: "trace"` if the failing span doesn't have a `_source.file` attached.
- **Git clone fails with "authentication failed".** Use a read-only PAT with `contents:read` scope. The token is never stored — it lives only for the duration of one `fix()` invocation.
- **`git apply` fails in dashboard mode.** The pre-check caught a conflict. Sync your source tree, re-run, or apply the downloaded `.patch` file manually.

## Packages

- [`@pathlight/fix`](../packages/fix/README.md) — core library
- [`@pathlight/cli`](../packages/cli/README.md) — `pathlight fix` subcommand
- Dashboard components at `apps/web/src/components/Fix/`
