import { describe, expect, it } from "vitest";
import {
  buildComfyTracePlan,
  exportComfyHistoryToPathlight,
  type ComfyHistoryEnvelope,
} from "./index.js";

const completedHistory: ComfyHistoryEnvelope = {
  "prompt-1": {
    prompt: [
      1,
      "prompt-1",
      {
        "1": {
          class_type: "CheckpointLoaderSimple",
          inputs: { ckpt_name: "model.safetensors" },
          _meta: { title: "Load model" },
        },
        "2": {
          class_type: "KSampler",
          inputs: { seed: 123, steps: 20, model: ["1", 0] },
        },
      },
      {},
      ["2"],
    ],
    outputs: {
      "2": { images: [{ filename: "out.png", subfolder: "", type: "output" }] },
    },
    status: { status_str: "success", completed: true, messages: [] },
  },
};

describe("buildComfyTracePlan", () => {
  it("maps a completed ComfyUI history item to a trace and node spans", () => {
    const plan = buildComfyTracePlan(completedHistory);

    expect(plan.status).toBe("completed");
    expect(plan.trace.metadata).toMatchObject({
      source: "comfyui",
      exportKind: "workflow_run",
      promptId: "prompt-1",
      nodeCount: 2,
    });
    expect(plan.spans).toHaveLength(2);
    expect(plan.spans[0]).toMatchObject({
      name: "comfy.node.CheckpointLoaderSimple",
      status: "completed",
      metadata: {
        nodeId: "1",
        classType: "CheckpointLoaderSimple",
        title: "Load model",
        outputNode: false,
      },
    });
    expect(plan.spans[1]).toMatchObject({
      name: "comfy.node.KSampler",
      output: { images: [{ filename: "out.png", subfolder: "", type: "output" }] },
      metadata: { outputNode: true },
    });
  });

  it("marks the trace and failed node span when ComfyUI reports an execution error", () => {
    const plan = buildComfyTracePlan({
      "prompt-2": {
        prompt: [
          1,
          "prompt-2",
          {
            "1": { class_type: "LoadImage", inputs: { image: "missing.png" } },
            "2": { class_type: "KSampler", inputs: { seed: 999 } },
          },
        ],
        status: {
          status_str: "error",
          completed: false,
          messages: [
            ["execution_error", { node_id: "1", exception_message: "Image file not found" }],
          ],
        },
      },
    });

    expect(plan.status).toBe("failed");
    expect(plan.error).toBe("Image file not found");
    expect(plan.spans[0]).toMatchObject({
      status: "failed",
      error: "Image file not found",
    });
    expect(plan.spans[1].status).toBe("completed");
  });
});

describe("exportComfyHistoryToPathlight", () => {
  it("posts a trace, spans, and final trace status to the collector", async () => {
    const calls: Array<{ url: string; method?: string; body: unknown }> = [];
    let spanNumber = 0;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });

      if (String(url).endsWith("/v1/traces")) {
        return new Response(JSON.stringify({ id: "trace_1" }), { status: 201 });
      }
      if (String(url).endsWith("/v1/spans")) {
        spanNumber += 1;
        return new Response(JSON.stringify({ id: `span_${spanNumber}` }), { status: 201 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const result = await exportComfyHistoryToPathlight(completedHistory, {
      collectorUrl: "http://collector.test/",
      fetchImpl,
    });

    expect(result.traceId).toBe("trace_1");
    expect(result.spanIds).toEqual(["span_1", "span_2"]);
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ["POST", "http://collector.test/v1/traces"],
      ["POST", "http://collector.test/v1/spans"],
      ["PATCH", "http://collector.test/v1/spans/span_1"],
      ["POST", "http://collector.test/v1/spans"],
      ["PATCH", "http://collector.test/v1/spans/span_2"],
      ["PATCH", "http://collector.test/v1/traces/trace_1"],
    ]);
    expect(calls.at(-1)?.body).toMatchObject({
      status: "completed",
      output: { promptId: "prompt-1", nodeCount: 2 },
    });
  });
});
