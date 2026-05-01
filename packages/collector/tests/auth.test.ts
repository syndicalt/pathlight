import { describe, expect, it } from "vitest";
import { createDb, runMigrations } from "@pathlight/db";
import { createRouter } from "../src/router.js";

async function buildAuthedCollector() {
  const db = createDb(":memory:");
  await runMigrations(db);
  const app = await createRouter({ db, accessToken: "test-token" });

  async function call<T = unknown>(
    path: string,
    init?: RequestInit,
  ): Promise<{ status: number; body: T }> {
    const req = new Request(`http://test${path}`, init);
    const res = await app.fetch(req);
    const text = await res.text();
    let body: T;
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = text as unknown as T;
    }
    return { status: res.status, body };
  }

  return { call };
}

const jsonPost = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

describe("collector access token", () => {
  it("allows health checks without a token", async () => {
    const { call } = await buildAuthedCollector();
    const res = await call<{ status: string }>("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("rejects /v1 requests without the configured token", async () => {
    const { call } = await buildAuthedCollector();
    const res = await call<{ error: { message: string } }>("/v1/traces");
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("unauthorized");
  });

  it("accepts bearer tokens on /v1 requests", async () => {
    const { call } = await buildAuthedCollector();
    const res = await call<{ id: string }>(
      "/v1/traces",
      jsonPost({ name: "agent" }, { authorization: "Bearer test-token" }),
    );
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/.+/);
  });

  it("accepts access_token query params for EventSource clients", async () => {
    const { call } = await buildAuthedCollector();
    const res = await call<{ traces: unknown[] }>("/v1/traces?access_token=test-token");
    expect(res.status).toBe(200);
    expect(res.body.traces).toEqual([]);
  });
});
