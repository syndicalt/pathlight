# Python SDK

The Python SDK mirrors the TypeScript SDK with Pythonic idioms — context
managers, keyword-only arguments, and async variants.

## Install

```bash
pip install pathlight
```

Requires Python 3.10+. The only hard dependency is `httpx`.

## Quick start

```python
from pathlight import Pathlight

pl = Pathlight(base_url="http://localhost:4100")

with pl.trace("research-agent", input={"query": "..."}) as trace:
    with trace.span("classify", type="llm", model="gpt-4o") as s:
        result = call_model(...)
        s.end(output=result, input_tokens=50, output_tokens=10, cost=0.003)
    trace.end(output=final)
```

Exceptions inside a `with` block mark the trace/span as `failed` with the
exception message.

## Async

```python
from pathlight import AsyncPathlight

async with AsyncPathlight(base_url="http://localhost:4100") as pl:
    trace = await pl.trace("agent")
    span = await trace.span("llm.chat", type="llm")
    await span.end(input_tokens=5, output_tokens=10)
    await trace.end(output="done")
```

## Parity with the TypeScript SDK

Every TS SDK feature is available in Python:

| Feature | Python | TS |
| --- | --- | --- |
| Auto git-context capture | ✅ | ✅ |
| Auto source-location capture | ✅ | ✅ |
| Live breakpoints | ✅ | ✅ |
| Context manager / `with` blocks | ✅ | — (Python-only) |
| Async variants | ✅ | — (TS is async by default) |
| Explicit `git` override for non-git runtimes | ✅ | ✅ |
| `disable_git_context` flag | ✅ | ✅ |

## Argument naming

Python uses `snake_case`; the TS SDK uses `camelCase`. Both SDKs send
`camelCase` over the wire so the collector sees the same payload shape
regardless of which SDK produced the trace.

| Python kwarg | Wire field |
| --- | --- |
| `base_url` | n/a (URL only) |
| `project_id` | `projectId` |
| `api_key` | Authorization header |
| `disable_git_context` | n/a (client config) |
| `git` | expanded to `gitCommit` / `gitBranch` / `gitDirty` |
| `input_tokens` / `output_tokens` | `inputTokens` / `outputTokens` |
| `tool_name` / `tool_args` / `tool_result` | `toolName` / `toolArgs` / `toolResult` |
| `parent_span_id` | `parentSpanId` |
| `timeout_ms` | `timeoutMs` |

## Breakpoints

```python
state = pl.breakpoint(
    label="post-retrieval",
    state={"docs": docs, "query": query},
    timeout_ms=15 * 60_000,   # default
)
# If the dashboard edited state before resume, `state` reflects those edits.
```

See [breakpoints docs](breakpoints.md) for the full flow.

## Location

`packages/sdk-python/` in the Pathlight monorepo. Same versioning cadence
as the TS SDK — currently **0.2.0**.

## Not yet supported

- **Framework adapters** (LangChain, LlamaIndex, CrewAI) — planned as
  `pathlight[langchain]` extras in a future release.
- **`pathlight-eval` Python port** — the assertion DSL is TS-only today.
  Call the collector API directly from pytest if you need Python-side
  trace assertions.
- **Pydantic model shapes** — the SDK uses plain dicts + dataclasses to
  avoid a hard dep on Pydantic. Opt-in Pydantic support possible later
  as an extra.
