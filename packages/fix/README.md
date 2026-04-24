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
  mode: { kind: "span" },           // "span" | "trace" | "bisect" (bisect lands in P2)
  onProgress: (evt) => console.error(evt),
});

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
```

## What it does

| Mode | Behavior |
|---|---|
| `span` | Fix the failing span(s) on the given trace. Default. |
| `trace` | Analyze the whole trace. Fix any failure found. |
| `bisect` | Walk a commit range, identify the regression commit, propose a fix against that SHA. *Implemented in P2 (#46).* |

## Source access

- **Path mode** (v1): `{ kind: "path", dir: "/abs/path" }`. File reads are scoped — no `..` escapes allowed.
- **Git mode** (P2): `{ kind: "git", repoUrl, token, ref? }`. Clones into a tempdir, cleans up after. Read-only tokens only.

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

## Roadmap

- **P2 (#46):** Git source adapter + bisect mode.
- **P3 (#47):** Web API endpoint so the dashboard can call the engine.
- **P4 (#48):** Encrypted BYOK key storage for the dashboard path.
- **P5 (#49):** Dashboard "Fix this" button + diff preview UX.

See [the parent issue](https://github.com/syndicalt/pathlight/issues/44) for the full architecture.

## License

MIT
