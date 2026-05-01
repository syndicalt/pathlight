/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TraceDetailPage from "./page";
import { fetchApi, patchApi } from "../../../lib/api";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "trace_1" }),
}));

vi.mock("../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api")>("../../../lib/api");
  return {
    ...actual,
    fetchApi: vi.fn(),
    patchApi: vi.fn(),
  };
});

vi.mock("../../../components/Fix/FixDialog", () => ({
  FixDialog: ({ open }: { open: boolean }) => open ? React.createElement("div", null, "Fix dialog open") : null,
}));

const fetchApiMock = vi.mocked(fetchApi);
const patchApiMock = vi.mocked(patchApi);

describe("TraceDetailPage", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    fetchApiMock.mockResolvedValue({
      trace: traceFixture(),
      spans: [llmSpanFixture()],
      events: [],
    });
    patchApiMock.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("loads a trace and marks unreviewed traces reviewed", async () => {
    render(React.createElement(TraceDetailPage));

    expect(await screen.findByText("Demo trace")).toBeTruthy();
    expect(screen.getByText("completed")).toBeTruthy();
    await waitFor(() => expect(patchApiMock).toHaveBeenCalledWith(
      "/v1/traces/trace_1",
      expect.objectContaining({ reviewedAt: expect.any(String) }),
    ));
  });

  it("runs replay from the selected LLM span", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        output: "replayed output",
        durationMs: 12,
        inputTokens: 2,
        outputTokens: 3,
      }), { status: 200 }),
    ));
    const user = userEvent.setup();

    render(React.createElement(TraceDetailPage));
    await user.click(await screen.findByText("llm.call"));
    await user.click(screen.getByRole("button", { name: "Run replay" }));

    expect(await screen.findByText("replayed output")).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:4100/v1/replay/llm",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"model\":\"gpt-test\""),
      }),
    );
  });
});

function traceFixture() {
  return {
    id: "trace_1",
    projectId: "project_1",
    name: "Demo trace",
    status: "completed",
    input: JSON.stringify({ prompt: "hello" }),
    output: JSON.stringify({ answer: "world" }),
    error: null,
    totalDurationMs: 40,
    totalTokens: 5,
    totalCost: null,
    metadata: null,
    tags: JSON.stringify(["demo"]),
    createdAt: "2026-05-01T12:00:00.000Z",
    completedAt: "2026-05-01T12:00:00.040Z",
    reviewedAt: null,
  };
}

function llmSpanFixture() {
  return {
    id: "span_1",
    traceId: "trace_1",
    parentSpanId: null,
    name: "llm.call",
    type: "llm",
    status: "completed",
    input: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    output: JSON.stringify({ text: "world" }),
    error: null,
    model: "gpt-test",
    provider: "openai",
    inputTokens: 2,
    outputTokens: 3,
    cost: null,
    toolName: null,
    toolArgs: null,
    toolResult: null,
    startedAt: "2026-05-01T12:00:00.000Z",
    completedAt: "2026-05-01T12:00:00.040Z",
    durationMs: 40,
    metadata: null,
  };
}
