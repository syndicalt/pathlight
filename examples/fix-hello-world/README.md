# fix-hello-world

A minimal walkthrough of the `pathlight fix` loop — introduce a deliberate bug, watch it fail in a Pathlight trace, let the fix engine propose the repair.

## Prerequisites

1. A running Pathlight collector + web UI:
   ```bash
   docker compose up -d   # from the pathlight repo root
   # Dashboard: http://localhost:3100
   # Collector: http://localhost:4100
   ```
2. A BYOK API key for Anthropic or OpenAI:
   ```bash
   export PATHLIGHT_LLM_API_KEY=sk-ant-...   # or sk-...
   ```

## Run

```bash
cd examples/fix-hello-world
npm install
npm run agent     # runs buggy-agent.ts, emits a failing trace, prints the trace ID
```

The agent reduces over an array to compute an average — but has no empty-array guard, so when it's called with `[]` it divides by zero and `NaN` propagates to the output. The trace is marked failed with the error.

Copy the trace ID printed by `npm run agent` and run:

```bash
pathlight fix <trace-id> --source-dir .
```

You should see:

- Progress lines on stderr (`# fetching trace...`, `# calling anthropic claude-opus-4-7...`, etc.)
- The proposed unified diff on stdout — an added empty-array check in `buggy-agent.ts`
- The explanation on stderr

To apply the fix in-place:

```bash
pathlight fix <trace-id> --source-dir . --apply
```

The diff lands via `git apply` and the test run passes on a retry.

## What this proves

- End-to-end BYOK loop works: trace in → diff out, using your own LLM key.
- The fix engine correctly infers `buggy-agent.ts` from the span's `_source` metadata and reads only that file — no hallucinated changes to files it didn't see.
- The engine emits a `fix.engine` meta-trace on every invocation — visit the dashboard at http://localhost:3100 to see both the original failure and the fix invocation side by side.

## Files

- `buggy-agent.ts` — the intentionally broken agent
- `package.json` — deps (`@pathlight/sdk`, `tsx`)
