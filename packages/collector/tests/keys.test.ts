import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { createDb, runMigrations } from "@pathlight/db";
import { KeyStore } from "@pathlight/keys";
import { nanoid } from "nanoid";
import { createRouter } from "../src/router.js";

async function buildKeysCollector() {
  const db = createDb(":memory:");
  await runMigrations(db);
  const sealKey = new Uint8Array(randomBytes(32));
  const keyStore = new KeyStore(db, sealKey);
  const app = await createRouter({ db, keyStore });

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

  // Seed a project so FK references resolve.
  async function seedProject(): Promise<string> {
    const id = nanoid();
    const res = await call<{ id: string; apiKey: string }>("/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `proj-${id}` }),
    });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  return { db, keyStore, call, seedProject };
}

describe("POST /v1/projects/:id/keys", () => {
  it("creates a key and returns masked metadata (no plaintext)", async () => {
    const { call, seedProject } = await buildKeysCollector();
    const projectId = await seedProject();
    const res = await call<Record<string, unknown>>(
      `/v1/projects/${projectId}/keys`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "llm",
          provider: "anthropic",
          label: "prod",
          value: "sk-ant-api-secret-abcd1234",
        }),
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("llm");
    expect(res.body.provider).toBe("anthropic");
    expect(res.body.label).toBe("prod");
    expect(res.body.preview).toBe("1234");

    // Hard invariant: response must NOT contain plaintext or sealed ciphertext.
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("sk-ant-api-secret-abcd1234");
    expect(serialized).not.toContain("sealedValue");
    expect(serialized).not.toContain("sealed_value");
  });

  it("rejects missing fields without echoing input", async () => {
    const { call, seedProject } = await buildKeysCollector();
    const projectId = await seedProject();
    const res = await call<{ error: { message: string } }>(
      `/v1/projects/${projectId}/keys`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "llm", value: "super-secret-value-xyz" }),
      },
    );
    expect(res.status).toBe(400);
    // Error must not contain the plaintext value.
    expect(res.body.error.message).not.toContain("super-secret-value-xyz");
  });

  it("rejects invalid kind", async () => {
    const { call, seedProject } = await buildKeysCollector();
    const projectId = await seedProject();
    const res = await call(`/v1/projects/${projectId}/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "wrong", provider: "x", label: "y", value: "z" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid json without echoing payload", async () => {
    const { call, seedProject } = await buildKeysCollector();
    const projectId = await seedProject();
    const res = await call<{ error: { message: string } }>(
      `/v1/projects/${projectId}/keys`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json-{{{",
      },
    );
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("invalid json body");
  });
});

describe("GET /v1/projects/:id/keys", () => {
  it("lists keys with only masked metadata", async () => {
    const { call, seedProject } = await buildKeysCollector();
    const projectId = await seedProject();
    await call(`/v1/projects/${projectId}/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "llm",
        provider: "openai",
        label: "primary",
        value: "sk-openai-plaintext-wxyz",
      }),
    });
    const res = await call<{ keys: Array<Record<string, unknown>> }>(
      `/v1/projects/${projectId}/keys`,
    );
    expect(res.status).toBe(200);
    expect(res.body.keys).toHaveLength(1);
    expect(res.body.keys[0].preview).toBe("wxyz");
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("sk-openai-plaintext-wxyz");
    expect(serialized).not.toContain("sealedValue");
    expect(serialized).not.toContain("sealed_value");
  });

  it("scopes listings per project (no cross-project leakage)", async () => {
    const { call, seedProject } = await buildKeysCollector();
    const p1 = await seedProject();
    const p2 = await seedProject();
    await call(`/v1/projects/${p1}/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "llm", provider: "anthropic", label: "a", value: "key-for-p1-aaaa" }),
    });
    const res = await call<{ keys: unknown[] }>(`/v1/projects/${p2}/keys`);
    expect(res.body.keys).toHaveLength(0);
  });
});

describe("DELETE /v1/projects/:id/keys/:keyId", () => {
  it("revokes a key", async () => {
    const { call, seedProject } = await buildKeysCollector();
    const projectId = await seedProject();
    const created = await call<{ id: string }>(`/v1/projects/${projectId}/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "llm", provider: "anthropic", label: "a", value: "secret-bbbb" }),
    });
    const res = await call(`/v1/projects/${projectId}/keys/${created.body.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const list = await call<{ keys: unknown[] }>(`/v1/projects/${projectId}/keys`);
    expect(list.body.keys).toHaveLength(0);
  });

  it("returns 404 on cross-project delete (same shape as not-found)", async () => {
    const { call, seedProject } = await buildKeysCollector();
    const p1 = await seedProject();
    const p2 = await seedProject();
    const created = await call<{ id: string }>(`/v1/projects/${p1}/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "llm", provider: "anthropic", label: "a", value: "secret-cccc" }),
    });
    const res = await call(`/v1/projects/${p2}/keys/${created.body.id}`, { method: "DELETE" });
    expect(res.status).toBe(404);
    // Key still exists under p1.
    const list = await call<{ keys: unknown[] }>(`/v1/projects/${p1}/keys`);
    expect(list.body.keys).toHaveLength(1);
  });
});

describe("PUT /v1/projects/:id/keys/:keyId (rotate)", () => {
  it("rotates atomically and returns new metadata", async () => {
    const { call, seedProject } = await buildKeysCollector();
    const projectId = await seedProject();
    const created = await call<{ id: string }>(`/v1/projects/${projectId}/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "llm", provider: "anthropic", label: "a", value: "old-secret-dddd" }),
    });
    const rot = await call<Record<string, unknown>>(
      `/v1/projects/${projectId}/keys/${created.body.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "llm", provider: "anthropic", label: "a", value: "new-secret-eeee" }),
      },
    );
    expect(rot.status).toBe(200);
    expect(rot.body.preview).toBe("eeee");
    const list = await call<{ keys: Array<{ id: string; preview: string }> }>(
      `/v1/projects/${projectId}/keys`,
    );
    expect(list.body.keys).toHaveLength(1);
    expect(list.body.keys[0].preview).toBe("eeee");
  });
});

describe("roundtrip: create -> list -> delete -> list empty", () => {
  it("full lifecycle via HTTP only", async () => {
    const { call, seedProject } = await buildKeysCollector();
    const projectId = await seedProject();
    const created = await call<{ id: string; preview: string }>(
      `/v1/projects/${projectId}/keys`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "llm",
          provider: "anthropic",
          label: "prod",
          value: "sk-ant-plaintext-ffff",
        }),
      },
    );
    expect(created.body.preview).toBe("ffff");
    const list1 = await call<{ keys: unknown[] }>(`/v1/projects/${projectId}/keys`);
    expect(list1.body.keys).toHaveLength(1);
    const del = await call(`/v1/projects/${projectId}/keys/${created.body.id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
    const list2 = await call<{ keys: unknown[] }>(`/v1/projects/${projectId}/keys`);
    expect(list2.body.keys).toHaveLength(0);
  });
});
