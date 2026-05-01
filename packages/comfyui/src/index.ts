export type SpanStatus = "completed" | "failed";

export interface ComfyPromptNode {
  class_type?: string;
  inputs?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export interface ComfyHistoryItem {
  prompt?: unknown;
  outputs?: Record<string, unknown>;
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: unknown[];
  };
  meta?: Record<string, unknown>;
}

export interface ComfyHistoryEnvelope {
  [promptId: string]: ComfyHistoryItem;
}

export interface PathlightTracePlan {
  trace: {
    name: string;
    input: unknown;
    metadata: Record<string, unknown>;
    tags: string[];
  };
  spans: PathlightSpanPlan[];
  output: Record<string, unknown>;
  status: SpanStatus;
  error?: string;
}

export interface PathlightSpanPlan {
  name: string;
  type: "chain";
  input: unknown;
  output?: unknown;
  status: SpanStatus;
  error?: string;
  metadata: Record<string, unknown>;
}

export interface BuildComfyTracePlanOptions {
  promptId?: string;
  traceName?: string;
}

export interface ExportComfyHistoryOptions extends BuildComfyTracePlanOptions {
  collectorUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface ExportComfyHistoryResult {
  traceId: string;
  spanIds: string[];
  plan: PathlightTracePlan;
}

interface ComfyFailure {
  nodeId?: string;
  message: string;
  raw: unknown;
}

export function unwrapComfyHistory(input: ComfyHistoryEnvelope | ComfyHistoryItem): {
  promptId?: string;
  history: ComfyHistoryItem;
} {
  if (isHistoryItem(input)) return { history: input };

  const entries = Object.entries(input);
  if (entries.length === 0) {
    throw new Error("ComfyUI history response is empty");
  }

  const [promptId, history] = entries[0];
  if (!isHistoryItem(history)) {
    throw new Error(`ComfyUI history entry ${promptId} is not a history item`);
  }

  return { promptId, history };
}

export function buildComfyTracePlan(
  input: ComfyHistoryEnvelope | ComfyHistoryItem,
  options: BuildComfyTracePlanOptions = {},
): PathlightTracePlan {
  const unwrapped = unwrapComfyHistory(input);
  const promptId = options.promptId ?? unwrapped.promptId;
  const history = unwrapped.history;
  const promptNodes = extractPromptNodes(history.prompt);
  const failures = extractFailures(history.status?.messages ?? []);
  const failuresByNode = new Map<string, ComfyFailure[]>();

  for (const failure of failures) {
    if (!failure.nodeId) continue;
    const existing = failuresByNode.get(failure.nodeId) ?? [];
    existing.push(failure);
    failuresByNode.set(failure.nodeId, existing);
  }

  const spans = Object.entries(promptNodes)
    .sort(([a], [b]) => Number(a) - Number(b) || a.localeCompare(b))
    .map(([nodeId, node]) => {
      const nodeFailures = failuresByNode.get(nodeId) ?? [];
      const classType = node.class_type ?? "unknown";
      const status: SpanStatus = nodeFailures.length > 0 ? "failed" : "completed";
      return {
        name: `comfy.node.${classType}`,
        type: "chain" as const,
        input: node.inputs ?? {},
        output: history.outputs?.[nodeId],
        status,
        error: nodeFailures.map((failure) => failure.message).join("; ") || undefined,
        metadata: {
          source: "comfyui",
          exportKind: "workflow_node",
          promptId,
          nodeId,
          classType,
          title: typeof node._meta?.title === "string" ? node._meta.title : undefined,
          outputNode: history.outputs ? Object.hasOwn(history.outputs, nodeId) : false,
        },
      };
    });

  const failed = history.status?.completed === false || failures.length > 0;
  const status: SpanStatus = failed ? "failed" : "completed";
  const error = failures.map((failure) => failure.message).join("; ") || undefined;
  const nodeCount = spans.length;
  const outputNodeIds = Object.keys(history.outputs ?? {});

  return {
    trace: {
      name: options.traceName ?? `ComfyUI workflow${promptId ? ` ${promptId}` : ""}`,
      input: {
        promptId,
        nodeCount,
        status: history.status?.status_str,
      },
      metadata: {
        source: "comfyui",
        exportKind: "workflow_run",
        promptId,
        nodeCount,
        outputNodeIds,
        comfyStatus: history.status,
        meta: history.meta,
      },
      tags: ["comfyui"],
    },
    spans,
    output: {
      promptId,
      nodeCount,
      outputNodeIds,
      outputs: history.outputs ?? {},
      status: history.status?.status_str,
      completed: history.status?.completed,
      failures,
    },
    status,
    error,
  };
}

export async function fetchComfyHistory(
  comfyUrl: string,
  promptId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ComfyHistoryEnvelope> {
  const url = joinUrl(comfyUrl, `/history/${encodeURIComponent(promptId)}`);
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`ComfyUI history request failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as ComfyHistoryEnvelope;
}

export async function exportComfyHistoryToPathlight(
  input: ComfyHistoryEnvelope | ComfyHistoryItem,
  options: ExportComfyHistoryOptions,
): Promise<ExportComfyHistoryResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const collectorUrl = options.collectorUrl.replace(/\/+$/, "");
  const plan = buildComfyTracePlan(input, options);
  const headers = jsonHeaders(options.apiKey);

  const traceCreate = await postJson<{ id: string }>(fetchImpl, `${collectorUrl}/v1/traces`, {
    ...plan.trace,
    status: "running",
  }, headers);

  const spanIds: string[] = [];
  for (const span of plan.spans) {
    const created = await postJson<{ id: string }>(fetchImpl, `${collectorUrl}/v1/spans`, {
      traceId: traceCreate.id,
      name: span.name,
      type: span.type,
      input: span.input,
      metadata: span.metadata,
    }, headers);
    spanIds.push(created.id);

    if (span.error) {
      await postJson(fetchImpl, `${collectorUrl}/v1/spans/${created.id}/events`, {
        name: "comfyui.node.error",
        level: "error",
        body: span.error,
        metadata: span.metadata,
      }, headers);
    }

    await patchJson(fetchImpl, `${collectorUrl}/v1/spans/${created.id}`, {
      status: span.status,
      output: span.output,
      error: span.error,
      metadata: span.metadata,
    }, headers);
  }

  await patchJson(fetchImpl, `${collectorUrl}/v1/traces/${traceCreate.id}`, {
    status: plan.status,
    output: plan.output,
    error: plan.error,
    metadata: plan.trace.metadata,
  }, headers);

  return { traceId: traceCreate.id, spanIds, plan };
}

function isHistoryItem(value: unknown): value is ComfyHistoryItem {
  return typeof value === "object" && value !== null && (
    "prompt" in value || "outputs" in value || "status" in value
  );
}

function extractPromptNodes(prompt: unknown): Record<string, ComfyPromptNode> {
  if (Array.isArray(prompt) && isRecord(prompt[2])) {
    return normalizePromptNodes(prompt[2]);
  }
  if (isRecord(prompt)) {
    return normalizePromptNodes(prompt);
  }
  return {};
}

function normalizePromptNodes(value: Record<string, unknown>): Record<string, ComfyPromptNode> {
  const nodes: Record<string, ComfyPromptNode> = {};
  for (const [nodeId, node] of Object.entries(value)) {
    if (!isRecord(node)) continue;
    nodes[nodeId] = {
      class_type: typeof node.class_type === "string" ? node.class_type : undefined,
      inputs: isRecord(node.inputs) ? node.inputs : undefined,
      _meta: isRecord(node._meta) ? node._meta : undefined,
    };
  }
  return nodes;
}

function extractFailures(messages: unknown[]): ComfyFailure[] {
  const failures: ComfyFailure[] = [];
  for (const message of messages) {
    const kind = Array.isArray(message) ? message[0] : undefined;
    const payload = Array.isArray(message) ? message[1] : message;
    const payloadRecord = isRecord(payload) ? payload : {};
    const kindText = typeof kind === "string" ? kind : "";
    const exceptionMessage = stringField(payloadRecord, "exception_message");
    const messageText = stringField(payloadRecord, "message");
    const nodeId = stringField(payloadRecord, "node_id") ?? stringField(payloadRecord, "nodeId");

    if (!kindText.includes("error") && !exceptionMessage && !messageText) continue;

    failures.push({
      nodeId,
      message: exceptionMessage ?? messageText ?? kindText,
      raw: message,
    });
  }
  return failures;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonHeaders(apiKey?: string): HeadersInit {
  return {
    "content-type": "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

async function postJson<T = unknown>(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  headers: HeadersInit,
): Promise<T> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return parseJsonResponse<T>(response, url);
}

async function patchJson<T = unknown>(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  headers: HeadersInit,
): Promise<T> {
  const response = await fetchImpl(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  return parseJsonResponse<T>(response, url);
}

async function parseJsonResponse<T>(response: Response, url: string): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Pathlight request failed for ${url}: ${response.status} ${text}`);
  }
  return (await response.json()) as T;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}
