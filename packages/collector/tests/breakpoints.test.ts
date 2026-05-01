import { describe, it, expect } from "vitest";
import { buildCollector } from "./fixtures.js";

const jsonPost = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("breakpoints", () => {
  it("register + resume round-trips the state", async () => {
    const { app } = await buildCollector();

    // Register in the background (long-polls until resumed).
    const waitPromise = app.fetch(
      new Request("http://test/v1/breakpoints", jsonPost({ label: "t", state: { x: 1 } })),
    );

    // Poll /list until the breakpoint is registered, then resume.
    let id: string | null = null;
    for (let i = 0; i < 20 && !id; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const listRes = await app.fetch(new Request("http://test/v1/breakpoints"));
      const body = (await listRes.json()) as { breakpoints: Array<{ id: string }> };
      if (body.breakpoints.length > 0) id = body.breakpoints[0].id;
    }
    expect(id).toBeTruthy();

    const resumeRes = await app.fetch(
      new Request(`http://test/v1/breakpoints/${id}/resume`, jsonPost({ state: { x: 42 } })),
    );
    expect(resumeRes.status).toBe(200);

    const waitRes = await waitPromise;
    const waitBody = (await waitRes.json()) as { resumed: boolean; state: { x: number } };
    expect(waitBody.resumed).toBe(true);
    expect(waitBody.state).toEqual({ x: 42 });
  });

  it("resume with no body passes undefined state", async () => {
    const { app } = await buildCollector();

    const waitPromise = app.fetch(
      new Request("http://test/v1/breakpoints", jsonPost({ label: "t", state: { original: true } })),
    );

    let id: string | null = null;
    for (let i = 0; i < 20 && !id; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const res = await app.fetch(new Request("http://test/v1/breakpoints"));
      const body = (await res.json()) as { breakpoints: Array<{ id: string }> };
      if (body.breakpoints.length > 0) id = body.breakpoints[0].id;
    }

    // POST /resume with no body at all
    await app.fetch(new Request(`http://test/v1/breakpoints/${id}/resume`, { method: "POST" }));

    const waitRes = await waitPromise;
    const body = (await waitRes.json()) as { state: unknown };
    // undefined state serializes as missing/absent in JSON
    expect(body.state).toBeUndefined();
  });

  it("cancel rejects the waiting request with 408", async () => {
    const { app } = await buildCollector();

    const waitPromise = app.fetch(
      new Request("http://test/v1/breakpoints", jsonPost({ label: "t", state: {} })),
    );

    let id: string | null = null;
    for (let i = 0; i < 20 && !id; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const res = await app.fetch(new Request("http://test/v1/breakpoints"));
      const body = (await res.json()) as { breakpoints: Array<{ id: string }> };
      if (body.breakpoints.length > 0) id = body.breakpoints[0].id;
    }

    await app.fetch(new Request(`http://test/v1/breakpoints/${id}/cancel`, { method: "POST" }));

    const waitRes = await waitPromise;
    expect(waitRes.status).toBe(408);
  });

  it("resume returns 404 for unknown breakpoint", async () => {
    const { call } = await buildCollector();
    const res = await call(
      "/v1/breakpoints/no-such-id/resume",
      jsonPost({ state: {} }),
    );
    expect(res.status).toBe(404);
  });

  it("GET /v1/breakpoints returns empty list and runtime identity initially", async () => {
    const { call } = await buildCollector();
    const res = await call<{ breakpoints: unknown[]; runtime: { id: string; startedAt: string } }>("/v1/breakpoints");
    expect(res.status).toBe(200);
    expect(res.body.breakpoints).toEqual([]);
    expect(res.body.runtime.id).toEqual(expect.any(String));
    expect(res.body.runtime.startedAt).toEqual(expect.any(String));
  });

  it("honors timeoutMs (auto-cancel)", async () => {
    const { app } = await buildCollector();
    const waitPromise = app.fetch(
      new Request("http://test/v1/breakpoints", jsonPost({ label: "t", state: {}, timeoutMs: 1000 })),
    );
    // The request body enforces min 1000ms so wait slightly longer.
    const waitRes = await waitPromise;
    expect(waitRes.status).toBe(408);
  });
});
