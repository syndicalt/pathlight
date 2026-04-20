import { describe, it, expect } from "vitest";
import { buildCollector } from "./fixtures.js";

describe("collector", () => {
  it("/health returns ok", async () => {
    const { call } = await buildCollector();
    const res = await call<{ status: string; service: string }>("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("pathlight-collector");
  });
});
