/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FixStream } from "./FixStream";
import { openSSE } from "../../lib/sse";
import type { FixFormValue } from "./FixForm";

vi.mock("../../lib/sse", () => ({
  openSSE: vi.fn(),
}));

const openSSEMock = vi.mocked(openSSE);

describe("FixStream", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders progress and forwards result payloads from SSE", async () => {
    const onResult = vi.fn();
    const onFail = vi.fn();
    openSSEMock.mockImplementation(async (options) => {
      options.onEvent({ event: "progress", data: JSON.stringify({ kind: "reading-source", fileCount: 2 }) });
      options.onEvent({
        event: "result",
        data: JSON.stringify({ diff: "diff --git", explanation: "fixed", filesChanged: ["src/a.ts"] }),
      });
      options.onEvent({ event: "done", data: "{}" });
    });

    render(React.createElement(FixStream, {
      projectId: "project_1",
      traceId: "trace_1",
      form: formFixture(),
      onResult,
      onFail,
    }));

    expect(await screen.findByText("# reading source (2 files)")).toBeTruthy();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({
      diff: "diff --git",
      explanation: "fixed",
      filesChanged: ["src/a.ts"],
    }));
    expect(onFail).not.toHaveBeenCalled();
  });

  it("forwards SSE errors to failure callback", async () => {
    const onResult = vi.fn();
    const onFail = vi.fn();
    openSSEMock.mockImplementation(async (options) => {
      options.onEvent({ event: "error", data: JSON.stringify({ message: "fix failed" }) });
    });

    render(React.createElement(FixStream, {
      projectId: "project_1",
      traceId: "trace_1",
      form: formFixture(),
      onResult,
      onFail,
    }));

    await waitFor(() => expect(onFail).toHaveBeenCalledWith("fix failed"));
    expect(onResult).not.toHaveBeenCalled();
  });
});

function formFixture(): FixFormValue {
  return {
    source: { kind: "path", dir: "/repo" },
    llm: { provider: "openai", model: "gpt-test", apiKey: "sk-test", baseUrl: "" },
    mode: { kind: "normal" },
  };
}
