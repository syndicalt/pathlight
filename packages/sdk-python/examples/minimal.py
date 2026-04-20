"""Minimal usage example — shows the happy path for both sync and async."""
from __future__ import annotations

import os
from pathlight import Pathlight


def main() -> None:
    pl = Pathlight(base_url=os.environ.get("PATHLIGHT_URL", "http://localhost:4100"))

    with pl.trace("demo-agent", input={"query": "How tall is Mount Everest?"}) as trace:
        # Pretend LLM call
        with trace.span("llm.chat", type="llm", model="gpt-4o", provider="openai") as s:
            answer = "8,849 meters"
            s.end(output=answer, input_tokens=20, output_tokens=5, cost=0.0001)

        # Pretend tool call
        with trace.span("verify", type="tool", tool_name="wiki_lookup") as t:
            t.end(tool_result={"confirmed": True})

        trace.end(output=answer)


if __name__ == "__main__":
    main()
