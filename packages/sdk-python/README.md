# pathlight — Python SDK

Python SDK for [Pathlight](https://github.com/syndicalt/pathlight) —
visual debugging, execution traces, and observability for AI agents.

## Install

```bash
pip install pathlight
```

## Usage

```python
from pathlight import Pathlight

pl = Pathlight(base_url="http://localhost:4100")

with pl.trace("research-agent", input={"query": "What is WebAssembly?"}) as trace:
    with trace.span("classify", type="llm", model="gpt-4o") as s:
        result = openai.chat.completions.create(...)
        s.end(
            output=result.choices[0].message.content,
            input_tokens=result.usage.prompt_tokens,
            output_tokens=result.usage.completion_tokens,
            cost=0.003,
        )

    with trace.span("web-search", type="tool", tool_name="search") as t:
        docs = search_tool("WebAssembly")
        t.end(tool_result=docs)

    trace.end(output=final_answer)
```

Context-manager exits auto-close the trace/span. Raised exceptions mark the
enclosing trace/span as `failed` with the exception message as the error.

## Async

```python
from pathlight import AsyncPathlight

async with AsyncPathlight(base_url="http://localhost:4100") as pl:
    trace = await pl.trace("agent")
    async with await trace.span("llm.chat", type="llm") as s:
        ...  # do work
        await s.end(input_tokens=50, output_tokens=10)
    await trace.end(output=result)
```

## Features

All the dashboard features that the TypeScript SDK surfaces are available
here too:

- **Auto git-context capture** — commit, branch, dirty flag via `git`
  subprocess (cached once per process).
- **Auto source-location capture** — stack-walk skips `pathlight/` and
  stdlib frames, stores `metadata._source` so the dashboard shows
  `file:line` for every span.
- **Live breakpoints** — `pl.breakpoint(label=..., state=...)` blocks
  until the dashboard resumes, returns the (possibly edited) state.
- **Fully typed** with a `py.typed` marker.

## Reference

### `Pathlight(...)`

| kwarg | type | purpose |
| --- | --- | --- |
| `base_url` | `str` | Collector URL (required) |
| `project_id` | `str \| None` | Group for multi-project installations |
| `api_key` | `str \| None` | Bearer token sent as `Authorization: Bearer …` |
| `disable_git_context` | `bool` | Skip auto-detection of commit/branch |
| `git` | `GitContext \| None` | Explicit override (wins over auto-detect) |
| `timeout` | `float` | httpx client timeout in seconds (default 10) |

### `Trace.span(name, *, type="custom", ...)`

Returns a `Span`. Types: `"llm"`, `"tool"`, `"retrieval"`, `"agent"`,
`"chain"`, `"custom"`.

### `Span.end(*, output=None, input_tokens=None, output_tokens=None, cost=None, tool_result=None, ...)`

Closes the span. All kwargs optional; use `status="failed"` + `error=...`
for explicit failure.

### `pl.breakpoint(*, label, state=None, timeout_ms=None)`

Registers a breakpoint and blocks until the dashboard resumes it. Returns
whatever the dashboard posted back (the edited state); falls back to the
original `state` on timeout or collector failure.

## License

MIT
