# @pathlight/eval

Assertion DSL and CI runner for [Pathlight](https://github.com/syndicalt/pathlight) traces.

Write pytest-style assertions against your agent's recent runs. Gate merges on
regressions, catch tool loops before they ship, keep per-run cost under control.

## Install

```bash
npm install --save-dev @pathlight/eval
```

## Write a spec

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
    expect(t).toCallTool("search_docs").atMost(3);
  },
);
```

## Run it

```bash
npx pathlight-eval specs/estimate.mjs
```

Exits `0` if every trace passes; `1` (with a per-trace failure list) otherwise,
so it drops into CI without fuss.

## Assertions

| Matcher                      | Fails when                                                  |
| ---------------------------- | ----------------------------------------------------------- |
| `toSucceed()`                | trace status !== `completed`                                |
| `toFail()`                   | trace status !== `failed`                                   |
| `toCompleteWithin(d)`        | total duration > `d` (ms number or `"5s"` / `"2m"` string)  |
| `toCostLessThan(usd)`        | total cost >= `usd`                                         |
| `toUseAtMostTokens(n)`       | total tokens > `n`                                          |
| `toHaveNoFailedSpans()`      | any span status === `failed`                                |
| `toHaveNoToolLoops(n=3)`     | same tool called `n` or more times consecutively            |
| `toCallTool(name).atMost(n)` | tool called > `n` times                                     |
| `toCallTool(name).atLeast(n)`| tool called < `n` times                                     |
| `toCallTool(name).exactly(n)`| tool called != `n` times                                    |
| `toMatchOutput(re \| str)`   | trace output doesn't match                                  |

## In CI

```yaml
- run: npx pathlight-eval specs/estimate.mjs --base-url ${{ secrets.PATHLIGHT_URL }}
```

Any failure fails the job. Combine with git-linked traces (SDK auto-captures
commit SHA) to answer "did this PR regress any agent?"
