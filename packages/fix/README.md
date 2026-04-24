# @pathlight/fix

Code-fixing agent core for Pathlight. Reads a failing trace, reads the source files the trace referenced, sends the trace + source to a user-supplied LLM (Anthropic or OpenAI), and returns a unified diff that fixes the root cause.

**BYOK.** Your API key, your LLM traffic. Pathlight never stores keys for the library / CLI surface, and never acts as an inference proxy.

## Install

```bash
npm install @pathlight/fix
```

## Library usage

```ts
import { fix } from "@pathlight/fix";

const result = await fix({
  traceId: "trc_xxx",
  collectorUrl: "http://localhost:4100",
  source: { kind: "path", dir: "/absolute/path/to/my/repo" },
  llm: {
    provider: "anthropic",          // or "openai"
    apiKey: process.env.ANTHROPIC_API_KEY!,
    // model: "claude-opus-4-7",    // defaults are set per provider
  },
  mode: { kind: "span" },           // "span" | "trace" | "bisect"
  onProgress: (evt) => console.error(evt),
});

// Git mode — clones a read-only checkout into a tempdir:
const remote = await fix({
  traceId: "trc_xxx",
  collectorUrl: "http://localhost:4100",
  source: {
    kind: "git",
    repoUrl: "https://github.com/acme/my-repo.git",
    token: process.env.GITHUB_TOKEN!, // read-only PAT or fine-grained token
    ref: "main",
  },
  llm: { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY! },
  mode: { kind: "span" },
});

// Bisect — find the regression commit, propose a fix against it:
const regressed = await fix({
  traceId: "trc_xxx",
  collectorUrl: "http://localhost:4100",
  source: {
    kind: "git",
    repoUrl: "https://github.com/acme/my-repo.git",
    token: process.env.GITHUB_TOKEN!,
  },
  llm: { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY! },
  mode: { kind: "bisect", from: "abc123", to: "def456" },
});
console.log(regressed.regressionSha, regressed.parentSha);

console.log(result.diff);           // unified diff, git-apply-ready
console.log(result.explanation);
console.log(result.filesChanged);
```

## CLI usage

```bash
export PATHLIGHT_LLM_API_KEY=sk-ant-...   # or sk-... for OpenAI

# Print the proposed diff to stdout (progress goes to stderr so piping works)
pathlight fix trc_xxx --source-dir . --provider anthropic

# Apply the diff to the working tree via `git apply`
pathlight fix trc_xxx --source-dir . --apply

# Pipe the diff into a branch review flow yourself
pathlight fix trc_xxx > /tmp/fix.patch
git checkout -b fix/trc_xxx
git apply /tmp/fix.patch

# Bisect across a commit range to find the regression commit
pathlight fix trc_xxx --bisect --from <good-sha> --to <bad-sha> --git-url https://github.com/acme/my-repo.git
# PATHLIGHT_GIT_TOKEN must be set for --git-url
```

## What it does

| Mode | Behavior |
|---|---|
| `span` | Fix the failing span(s) on the given trace. Default. |
| `trace` | Analyze the whole trace. Fix any failure found. |
| `bisect` | Walk a commit range, identify the regression commit, propose a fix against that SHA. Requires a git source. |

## Source access

- **Path mode** (v1): `{ kind: "path", dir: "/abs/path" }`. File reads are scoped — no `..` escapes allowed.
- **Git mode**: `{ kind: "git", repoUrl, token, ref? }`. Shallow-clones (depth=1 by default; deepens automatically during bisect) into a tempdir, checks out `ref`, cleans up after. Read-only tokens only in v1 — no push, no PR.

## Providers

| Provider | Default model | Configure with |
|---|---|---|
| Anthropic | `claude-opus-4-7` | `--provider anthropic`, `ANTHROPIC_API_KEY` |
| OpenAI | `gpt-5.4` | `--provider openai`, `OPENAI_API_KEY` |

Override with `--model <id>` or `llm.model`.

## What it emits

Every invocation writes a `fix.engine` meta-trace to your Pathlight collector. The meta-trace carries: the input trace ID, mode, source kind, provider, model, token counts, and the list of files the proposed diff changes. It does **not** carry the API key, the git token, the diff body, or the explanation text — those stay out of observability to avoid leaking source code or secrets.

## Security

- `llm.apiKey` and `source.token` are never logged, never emitted in traces, never echoed in errors.
- Read-only tokens only (v1). No branch pushes. No PR creation.
- `fix()` errors always surface as `FixError` — raw SDK errors (which can include request headers) never reach callers.

## Bisect details

`bisect` requires a git source (it needs to check out different commits). The engine:

1. Validates `to` reproduces the failure and `from` does not (two endpoint probes).
2. Binary-searches the `from..to` commit range — O(log₂ N) probe calls for N commits.
3. Returns `{ regressionSha, parentSha, diff, explanation, ... }` where the diff is proposed against `regressionSha`.

Each probe does a fresh checkout in the tempdir and re-runs the span-mode fix engine there. Shallow clones are deepened automatically if a probe SHA isn't in the current history.

Provide a custom probe (e.g. backed by `pathlight-eval` assertions) via the library API:

```ts
import { bisect, makeGitCheckoutProbe } from "@pathlight/fix";
```

## Companion surfaces

The library is the core. The fix engine ships behind two more surfaces, all
pointing at the same `fix()` entry:

- **CLI** — `pathlight fix <trace-id>` for headless / CI use. See
  [`@pathlight/cli`](https://www.npmjs.com/package/@pathlight/cli).
- **Dashboard** — `/v1/fix` SSE endpoint on the collector + the **Fix this**
  button on every failing span in the web UI. The dashboard's BYOK picker
  resolves stored key IDs to plaintext server-side (the browser never sees
  the secret). See [docs/fix.md](https://github.com/syndicalt/pathlight/blob/master/docs/fix.md)
  for the dashboard walkthrough and [docs/byok-keys.md](https://github.com/syndicalt/pathlight/blob/master/docs/byok-keys.md)
  for the encrypted key store.

## Try it without writing your own bug

The repo ships a tiny demo agent and a seed script:

```bash
# Run a Pathlight stack
docker compose up -d

# Seed a project + failing trace + matching demo source
node scripts/seed-screenshots.mjs

# Use the printed trace id with the CLI (or the dashboard's "Fix this" button)
export PATHLIGHT_LLM_API_KEY=sk-ant-...
pathlight fix <printed-trace-id> \
  --source-dir examples/quote-agent
```

The engine reads `examples/quote-agent/src/agents/quote.ts`, identifies the
JSON-parsing bug in `composeEstimate`, and emits a diff that tightens the
system prompt and adds a defensive parser.

## License

MIT
