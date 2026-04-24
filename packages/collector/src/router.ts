import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Db } from "@pathlight/db";
import type { KeyStore } from "@pathlight/keys";
import { createTraceRoutes } from "./routes/traces.js";
import { createSpanRoutes } from "./routes/spans.js";
import { createProjectRoutes } from "./routes/projects.js";
import { createBreakpointRoutes } from "./routes/breakpoints.js";
import { createReplayRoutes } from "./routes/replay.js";
import { createOtlpRoutes } from "./routes/otlp.js";
import { createFixRoutes } from "./routes/fix.js";
import { createKeyRoutes } from "./routes/keys.js";

interface RouterContext {
  db: Db;
  keyStore?: KeyStore;
}

export async function createRouter(ctx: RouterContext) {
  const app = new Hono();

  // CORS — allow all origins (dev tool)
  app.use("/*", cors({
    origin: "*",
    exposeHeaders: ["X-Total-Count"],
  }));

  // API routes
  app.route("/v1/traces", createTraceRoutes(ctx.db));
  app.route("/v1/spans", createSpanRoutes(ctx.db));
  app.route("/v1/projects", createProjectRoutes(ctx.db));
  app.route("/v1/breakpoints", createBreakpointRoutes());
  app.route("/v1/replay", createReplayRoutes());
  app.route("/v1/otlp", createOtlpRoutes(ctx.db));
  app.route("/v1/fix", createFixRoutes());

  // BYOK key management — nested under /v1/projects/:id/keys. Only
  // mounted when a KeyStore is provided (requires PATHLIGHT_SEAL_KEY).
  if (ctx.keyStore) {
    app.route("/v1/projects/:id/keys", createKeyRoutes(ctx.keyStore));
  }

  // Health check
  app.get("/health", (c) => c.json({ status: "ok", service: "pathlight-collector" }));

  return app;
}
