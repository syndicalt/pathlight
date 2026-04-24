import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// A trace represents a complete agent execution (one run of an agent)
export const traces = sqliteTable("traces", {
  id: text("id").primaryKey(),
  projectId: text("project_id"),
  name: text("name").notNull(),                  // e.g. "research-agent", "code-review-agent"
  status: text("status", { enum: ["running", "completed", "failed", "cancelled"] })
    .notNull()
    .default("running"),
  input: text("input"),                           // JSON: the initial input to the agent
  output: text("output"),                         // JSON: the final output
  error: text("error"),                           // error message if failed
  totalDurationMs: integer("total_duration_ms"),
  totalTokens: integer("total_tokens"),
  totalCost: real("total_cost"),
  metadata: text("metadata"),                     // JSON: arbitrary user metadata
  tags: text("tags"),                             // JSON array of strings for filtering
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
  // Git provenance — captured by the SDK at trace start so dashboard can
  // attribute latency/cost regressions back to a specific commit.
  gitCommit: text("git_commit"),          // full SHA, e.g. 7a2bf14...
  gitBranch: text("git_branch"),          // e.g. "feature/retry-loop"
  gitDirty: integer("git_dirty", { mode: "boolean" }),  // uncommitted changes at run time
});

// A span represents a single step within a trace (LLM call, tool use, decision, etc.)
export const spans = sqliteTable("spans", {
  id: text("id").primaryKey(),
  traceId: text("trace_id")
    .notNull()
    .references(() => traces.id),
  parentSpanId: text("parent_span_id"),           // null for root spans, enables nesting
  name: text("name").notNull(),                   // e.g. "llm.chat", "tool.search", "agent.decide"
  type: text("type", {
    enum: ["llm", "tool", "retrieval", "agent", "chain", "custom"],
  }).notNull(),
  status: text("status", { enum: ["running", "completed", "failed"] })
    .notNull()
    .default("running"),
  input: text("input"),                           // JSON: input to this step
  output: text("output"),                         // JSON: output from this step
  error: text("error"),
  // LLM-specific fields
  model: text("model"),                           // e.g. "gpt-4o", "claude-sonnet-4-6"
  provider: text("provider"),                     // e.g. "openai", "anthropic"
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cost: real("cost"),
  // Tool-specific fields
  toolName: text("tool_name"),                    // e.g. "web_search", "code_exec"
  toolArgs: text("tool_args"),                    // JSON: arguments passed to the tool
  toolResult: text("tool_result"),                // JSON: result from the tool
  // Timing
  startedAt: integer("started_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  durationMs: integer("duration_ms"),
  // Context
  metadata: text("metadata"),                     // JSON: arbitrary metadata
});

// Events are point-in-time annotations within a span (logs, decisions, errors)
export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  traceId: text("trace_id")
    .notNull()
    .references(() => traces.id),
  spanId: text("span_id")
    .references(() => spans.id),
  name: text("name").notNull(),                   // e.g. "decision", "log", "error", "warning"
  level: text("level", { enum: ["debug", "info", "warn", "error"] })
    .notNull()
    .default("info"),
  body: text("body"),                             // JSON or string content
  metadata: text("metadata"),
  timestamp: integer("timestamp", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Projects group traces (optional, for multi-project support)
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  apiKey: text("api_key").notNull().unique(),      // for SDK authentication
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// BYOK API keys — encrypted-at-rest store for per-project LLM API keys
// and git tokens. `sealed_value` is libsodium crypto_secretbox_easy
// ciphertext + nonce (packed). Plaintext NEVER lives here and must NEVER
// be returned from any endpoint. `preview` is the unencrypted last-4
// characters of the plaintext for masked UI display (••••••••<last-4>).
export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  kind: text("kind", { enum: ["llm", "git"] }).notNull(),
  provider: text("provider").notNull(),     // e.g. "anthropic", "openai", "github"
  label: text("label").notNull(),           // user-chosen display name
  sealedValue: text("sealed_value").notNull(),  // libsodium ciphertext (nonce+ct, base64)
  preview: text("preview").notNull(),       // last-4 chars of plaintext, for masked display only
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
});

// Scores — quality/eval annotations on traces or spans
export const scores = sqliteTable("scores", {
  id: text("id").primaryKey(),
  traceId: text("trace_id")
    .notNull()
    .references(() => traces.id),
  spanId: text("span_id")
    .references(() => spans.id),
  name: text("name").notNull(),                   // e.g. "accuracy", "relevance", "helpfulness"
  value: real("value").notNull(),                  // numeric score
  comment: text("comment"),
  source: text("source", { enum: ["human", "auto"] }).notNull().default("human"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
