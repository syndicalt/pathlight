import { describe, it, expect, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import { createDb, runMigrations, projects } from "@pathlight/db";
import { nanoid } from "nanoid";
import { KeyStore } from "./store.js";
import { createKeyStoreSecretResolver } from "./resolver.js";

async function setup() {
  const db = createDb(":memory:");
  await runMigrations(db);
  const sealKey = new Uint8Array(randomBytes(32));
  const store = new KeyStore(db, sealKey);
  const resolver = createKeyStoreSecretResolver(store);
  const projectId = nanoid();
  await db.insert(projects).values({ id: projectId, name: "p", apiKey: nanoid() }).run();
  return { db, store, resolver, projectId };
}

describe("KeyStoreSecretResolver", () => {
  it("resolveLlmKey returns the plaintext for a matching llm key", async () => {
    const { store, resolver, projectId } = await setup();
    const plaintext = "sk-ant-plaintext-abcd1234";
    const meta = await store.create({
      projectId,
      kind: "llm",
      provider: "anthropic",
      label: "prod",
      plaintext,
    });
    const out = await resolver.resolveLlmKey(projectId, meta.id);
    expect(out).toBe(plaintext);
  });

  it("resolveLlmKey returns null when the key is git-kind (no mis-typed secrets)", async () => {
    const { store, resolver, projectId } = await setup();
    const meta = await store.create({
      projectId,
      kind: "git",
      provider: "github",
      label: "deploy",
      plaintext: "ghp_token_wxyz5678",
    });
    const out = await resolver.resolveLlmKey(projectId, meta.id);
    expect(out).toBeNull();
  });

  it("resolveGitToken returns null when the key is llm-kind", async () => {
    const { store, resolver, projectId } = await setup();
    const meta = await store.create({
      projectId,
      kind: "llm",
      provider: "openai",
      label: "prod",
      plaintext: "sk-openai-abcd",
    });
    const out = await resolver.resolveGitToken(projectId, meta.id);
    expect(out).toBeNull();
  });

  it("returns null on cross-project access (same shape as not-found)", async () => {
    const { db, store, resolver } = await setup();
    const p1 = nanoid();
    const p2 = nanoid();
    await db.insert(projects).values({ id: p1, name: "p1", apiKey: nanoid() }).run();
    await db.insert(projects).values({ id: p2, name: "p2", apiKey: nanoid() }).run();
    const meta = await store.create({
      projectId: p1,
      kind: "llm",
      provider: "anthropic",
      label: "a",
      plaintext: "secret-eeee",
    });
    const out = await resolver.resolveLlmKey(p2, meta.id);
    expect(out).toBeNull();
  });

  it("returns null for unknown key IDs", async () => {
    const { resolver, projectId } = await setup();
    const out = await resolver.resolveLlmKey(projectId, "does-not-exist");
    expect(out).toBeNull();
  });
});
