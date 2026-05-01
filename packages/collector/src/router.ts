import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Db } from "@pathlight/db";
import { createKeyStoreSecretResolver, type KeyStore } from "@pathlight/keys";
import { createTraceRoutes } from "./routes/traces.js";
import { createSpanRoutes } from "./routes/spans.js";
import { createProjectRoutes } from "./routes/projects.js";
import { createBreakpointRoutes } from "./routes/breakpoints.js";
import { createReplayRoutes } from "./routes/replay.js";
import { createOtlpRoutes } from "./routes/otlp.js";
import { createFixRoutes } from "./routes/fix.js";
import { createFixApplyRoutes } from "./routes/fix-apply.js";
import { createKeyRoutes } from "./routes/keys.js";

interface RouterContext {
  db: Db;
  keyStore?: KeyStore;
  accessToken?: string;
}

export async function createRouter(ctx: RouterContext) {
  const app = new Hono();

  // CORS — allow all origins (dev tool)
  app.use("/*", cors({
    origin: "*",
    exposeHeaders: ["X-Total-Count"],
  }));

  if (ctx.accessToken) {
    app.use("/v1/*", async (c, next) => {
      const authorization = c.req.header("authorization");
      const pathlightToken = c.req.header("x-pathlight-token");
      const queryToken = c.req.query("access_token");
      if (
        authorization === `Bearer ${ctx.accessToken}` ||
        pathlightToken === ctx.accessToken ||
        queryToken === ctx.accessToken
      ) {
        return next();
      }

      return c.json({ error: { message: "unauthorized" } }, 401);
    });
  }

  // API routes
  app.route("/v1/traces", createTraceRoutes(ctx.db));
  app.route("/v1/spans", createSpanRoutes(ctx.db));
  app.route("/v1/projects", createProjectRoutes(ctx.db));
  app.route("/v1/breakpoints", createBreakpointRoutes());
  app.route("/v1/replay", createReplayRoutes());
  app.route("/v1/otlp", createOtlpRoutes(ctx.db));
  // Wire the fix route to the BYOK key store when one is configured.
  // Without this, /v1/fix falls back to the env-only resolver and the
  // dashboard's key picker is decorative — the engine can't see the
  // sealed keys it just selected. (Closes the TODO(#48) in
  // fix-secret-resolver.ts.)
  app.route(
    "/v1/fix",
    createFixRoutes(
      ctx.keyStore ? { secretResolver: createKeyStoreSecretResolver(ctx.keyStore) } : undefined,
    ),
  );
  app.route("/v1/fix-apply", createFixApplyRoutes());

  // BYOK key management — nested under /v1/projects/:id/keys. Only
  // mounted when a KeyStore is provided (requires PATHLIGHT_SEAL_KEY).
  if (ctx.keyStore) {
    app.route("/v1/projects/:id/keys", createKeyRoutes(ctx.keyStore));
  }

  // Health check
  app.get("/health", (c) => c.json({ status: "ok", service: "pathlight-collector" }));

  return app;
}
