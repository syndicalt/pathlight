declare module "openclaw/plugin-sdk/plugin-entry" {
  export type PluginHookAgentContext = {
    runId?: string;
    agentId?: string;
    sessionKey?: string;
    sessionId?: string;
    workspaceDir?: string;
    modelProviderId?: string;
    modelId?: string;
    messageProvider?: string;
    trigger?: string;
    channelId?: string;
  };

  export type PluginHookSubagentContext = {
    runId?: string;
    childSessionKey?: string;
    requesterSessionKey?: string;
  };

  export type PluginHookBeforeAgentStartEvent = Record<string, unknown>;

  export type PluginHookAgentEndEvent = {
    messages: unknown[];
    success: boolean;
    error?: string;
    durationMs?: number;
  };

  export type PluginHookLlmInputEvent = {
    runId: string;
    sessionId: string;
    provider: string;
    model: string;
    systemPrompt?: string;
    prompt: string;
    historyMessages: unknown[];
    imagesCount: number;
  };

  export type PluginHookLlmOutputEvent = {
    runId: string;
    sessionId: string;
    provider: string;
    model: string;
    resolvedRef?: string;
    assistantTexts: string[];
    lastAssistant?: unknown;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      total?: number;
    };
  };

  export type PluginHookBeforeToolCallEvent = {
    toolName: string;
    params: Record<string, unknown>;
    runId?: string;
    toolCallId?: string;
  };

  export type PluginHookAfterToolCallEvent = {
    toolName: string;
    params: Record<string, unknown>;
    runId?: string;
    toolCallId?: string;
    result?: unknown;
    error?: string;
    durationMs?: number;
  };

  export type PluginHookSubagentSpawningEvent = {
    childSessionKey: string;
    agentId: string;
    label?: string;
    mode: "run" | "session";
  };

  export type PluginHookSubagentEndedEvent = {
    targetSessionKey: string;
    targetKind: "subagent" | "acp";
    reason: string;
    accountId?: string;
    runId?: string;
    endedAt?: number;
    outcome?: "ok" | "error" | "timeout" | "killed" | "reset" | "deleted";
    error?: string;
  };

  export type PluginHookHandlerMap = {
    before_agent_start: (event: PluginHookBeforeAgentStartEvent, ctx: PluginHookAgentContext) => Promise<void> | void;
    agent_end: (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext) => Promise<void> | void;
    llm_input: (event: PluginHookLlmInputEvent, ctx: PluginHookAgentContext) => Promise<void> | void;
    llm_output: (event: PluginHookLlmOutputEvent, ctx: PluginHookAgentContext) => Promise<void> | void;
    before_tool_call: (event: PluginHookBeforeToolCallEvent, ctx: PluginHookAgentContext) => Promise<void> | void;
    after_tool_call: (event: PluginHookAfterToolCallEvent, ctx: PluginHookAgentContext) => Promise<void> | void;
    subagent_spawning: (event: PluginHookSubagentSpawningEvent, ctx: PluginHookSubagentContext) => Promise<void> | void;
    subagent_ended: (event: PluginHookSubagentEndedEvent, ctx: PluginHookSubagentContext) => Promise<void> | void;
  };

  export type PluginHookName = keyof PluginHookHandlerMap;

  export type OpenClawPluginApi = {
    id: string;
    name: string;
    logger: {
      info: (msg: string, meta?: unknown) => void;
      warn: (msg: string, meta?: unknown) => void;
      error: (msg: string, meta?: unknown) => void;
      debug: (msg: string, meta?: unknown) => void;
    };
    pluginConfig?: Record<string, unknown>;
    on: <K extends PluginHookName>(
      hookName: K,
      handler: PluginHookHandlerMap[K],
      opts?: { priority?: number },
    ) => void;
  };

  export function definePluginEntry(options: {
    id: string;
    name: string;
    description: string;
    register: (api: OpenClawPluginApi) => void;
  }): unknown;
}
