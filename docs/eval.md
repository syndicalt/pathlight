# Eval-as-code + CI

See [packages/eval/README.md](../packages/eval/README.md) for the full
`@pathlight/eval` reference.

## TL;DR

```bash
npm install --save-dev @pathlight/eval
```

```js
// specs/estimate.mjs
import { expect, evaluate } from "@pathlight/eval";

export default () => evaluate(
  { baseUrl: "http://localhost:4100", name: "estimate", limit: 20 },
  (t) => {
    expect(t).toSucceed();
    expect(t).toCompleteWithin("10s");
    expect(t).toCostLessThan(0.05);
    expect(t).toHaveNoToolLoops();
  },
);
```

```bash
npx pathlight-eval specs/estimate.mjs
```

Exit `0` on all-pass; `1` with a per-trace failure list on any miss; `2`
on spec-loading errors. Drop-in ready for GitHub Actions.

## The case for eval-as-code

Traditional unit tests run synthetic inputs. Pathlight evals run over
**real recent traces** — production (or staging) runs your agent actually
performed. When the traces already exist, the harness cost is zero and the
signal is orders of magnitude better than synthetic replay.

Combined with git-linked traces, a CI job running eval against traces from
the last 24h tells you exactly which merge regressed what.

## GitHub Actions example

```yaml
name: Agent regression check
on:
  schedule:
    - cron: "0 */6 * * *"   # every 6 hours
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22" }
      - run: npm ci
      - run: npx pathlight-eval specs/estimate.mjs \
          --base-url ${{ secrets.PATHLIGHT_URL }}
```

Pair with a nightly or on-merge cron. Failures page the on-call via your
existing GitHub alert pipeline; no new infrastructure.

## Matchers

| Matcher | Fails when |
| --- | --- |
| `toSucceed()` | trace status ≠ `completed` |
| `toFail()` | trace status ≠ `failed` |
| `toCompleteWithin(d)` | total duration > `d` (ms number or `"5s"` / `"2m"` string) |
| `toCostLessThan(usd)` | total cost ≥ `usd` |
| `toUseAtMostTokens(n)` | total tokens > `n` |
| `toHaveNoFailedSpans()` | any span status = `failed` |
| `toHaveNoToolLoops(n=3)` | same tool called `n` or more times consecutively |
| `toCallTool(name).atMost(n)` | tool called > `n` times |
| `toCallTool(name).atLeast(n)` | tool called < `n` times |
| `toCallTool(name).exactly(n)` | tool called ≠ `n` times |
| `toMatchOutput(re \| str)` | trace output doesn't match |

All matchers throw `AssertionError` with a human-readable message and the
failing trace ID; the runner aggregates these into a summary.

## Scoping traces

The `evaluate(options, ...)` first argument decides which traces get
checked:

```typescript
evaluate({
  baseUrl: "http://localhost:4100",
  name: "estimate",        // trace name filter
  status: "completed",     // status filter
  projectId: "proj_…",     // project filter
  limit: 20,               // max to check (default 20)
  gitCommit: "abc1234",    // prefix match against git_commit
  traceIds: ["id1", "id2"] // overrides all list filters
}, (t) => { /* … */ })
```

## See also

- [packages/eval/README.md](../packages/eval/README.md) — full reference
- [docs/git-regressions.md](git-regressions.md) — pair with commit-scoped
  assertions for merge-gate coverage
