import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Db } from "@pathlight/db";
import { createTraceRoutes } from "./routes/traces.js";
import { createSpanRoutes } from "./routes/spans.js";
import { createProjectRoutes } from "./routes/projects.js";

interface RouterContext {
  db: Db;
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

  // Health check
  app.get("/health", (c) => c.json({ status: "ok", service: "pathlight-collector" }));

  return app;
}
