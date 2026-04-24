/**
 * Collector routes: POST/GET/DELETE /v1/projects/:id/keys
 *
 * SECURITY NOTES (parent invariant #2/#3 from issue #44):
 *   - Never return plaintext from any endpoint here. POST returns the
 *     created row's METADATA, not the plaintext that was just sealed.
 *   - Never log request bodies (would leak the plaintext field).
 *   - Never echo the plaintext in an error message or response.
 *   - GET lists are metadata-only by construction — the store's
 *     `toMetadata()` helper does not include `sealed_value`.
 */

import { Hono } from "hono";
import type { KeyStore, ApiKeyKind } from "@pathlight/keys";

interface CreateBody {
  kind?: string;
  provider?: string;
  label?: string;
  value?: string;       // plaintext — sealed immediately, never persisted as-is
}

interface RotateBody {
  kind?: string;
  provider?: string;
  label?: string;
  value?: string;
}

export function createKeyRoutes(store: KeyStore) {
  // Mounted under /v1/projects/:id/keys — Hono's param forwarding
  // requires mergeParams. We read :id via c.req.param("id").
  const app = new Hono();

  // List keys for a project.
  app.get("/", async (c) => {
    const projectId = c.req.param("id");
    if (!projectId) {
      return c.json({ error: { message: "project id required", type: "validation_error" } }, 400);
    }
    const keys = await store.list(projectId);
    // Map to API shape — explicitly enumerate fields (defence in depth
    // against future schema additions accidentally leaking sensitive data).
    return c.json({
      keys: keys.map((k) => ({
        id: k.id,
        projectId: k.projectId,
        kind: k.kind,
        provider: k.provider,
        label: k.label,
        preview: k.preview,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
      })),
    });
  });

  // Create a new key. The `value` field is the plaintext secret — it is
  // sealed immediately and MUST NOT be echoed back or logged.
  app.post("/", async (c) => {
    const projectId = c.req.param("id");
    if (!projectId) {
      return c.json({ error: { message: "project id required", type: "validation_error" } }, 400);
    }

    let body: CreateBody;
    try {
      body = await c.req.json<CreateBody>();
    } catch {
      // Intentionally generic — don't echo the body.
      return c.json({ error: { message: "invalid json body", type: "validation_error" } }, 400);
    }

    // Validate. Error messages NEVER include the `value` field.
    const missing: string[] = [];
    if (!body.kind) missing.push("kind");
    if (!body.provider) missing.push("provider");
    if (!body.label) missing.push("label");
    if (!body.value) missing.push("value");
    if (missing.length) {
      return c.json(
        { error: { message: `missing required fields: ${missing.join(", ")}`, type: "validation_error" } },
        400,
      );
    }
    if (body.kind !== "llm" && body.kind !== "git") {
      return c.json({ error: { message: "kind must be 'llm' or 'git'", type: "validation_error" } }, 400);
    }

    try {
      const metadata = await store.create({
        projectId,
        kind: body.kind as ApiKeyKind,
        provider: body.provider!,
        label: body.label!,
        plaintext: body.value!,
      });
      // Return metadata ONLY — explicit field list (do not spread the
      // store record; a future field named e.g. `sealedValue` would
      // then leak via JSON.stringify).
      return c.json(
        {
          id: metadata.id,
          projectId: metadata.projectId,
          kind: metadata.kind,
          provider: metadata.provider,
          label: metadata.label,
          preview: metadata.preview,
          createdAt: metadata.createdAt,
          lastUsedAt: metadata.lastUsedAt,
        },
        201,
      );
    } catch (err) {
      // Generic message — never include the body or err.message verbatim
      // because upstream libraries might have stringified the payload
      // into the error.
      void err;
      return c.json({ error: { message: "failed to create key", type: "internal_error" } }, 500);
    }
  });

  // Rotate = atomic (create new + delete old). Returns the NEW metadata.
  app.put("/:keyId", async (c) => {
    const projectId = c.req.param("id");
    const keyId = c.req.param("keyId");
    if (!projectId || !keyId) {
      return c.json({ error: { message: "project id and key id required", type: "validation_error" } }, 400);
    }

    let body: RotateBody;
    try {
      body = await c.req.json<RotateBody>();
    } catch {
      return c.json({ error: { message: "invalid json body", type: "validation_error" } }, 400);
    }

    const missing: string[] = [];
    if (!body.kind) missing.push("kind");
    if (!body.provider) missing.push("provider");
    if (!body.label) missing.push("label");
    if (!body.value) missing.push("value");
    if (missing.length) {
      return c.json(
        { error: { message: `missing required fields: ${missing.join(", ")}`, type: "validation_error" } },
        400,
      );
    }
    if (body.kind !== "llm" && body.kind !== "git") {
      return c.json({ error: { message: "kind must be 'llm' or 'git'", type: "validation_error" } }, 400);
    }

    try {
      const metadata = await store.rotate(projectId, keyId, {
        kind: body.kind as ApiKeyKind,
        provider: body.provider!,
        label: body.label!,
        plaintext: body.value!,
      });
      if (!metadata) {
        // Same shape as "not found" — do not leak existence of a key
        // in a different project.
        return c.json({ error: { message: "key not found", type: "not_found" } }, 404);
      }
      return c.json({
        id: metadata.id,
        projectId: metadata.projectId,
        kind: metadata.kind,
        provider: metadata.provider,
        label: metadata.label,
        preview: metadata.preview,
        createdAt: metadata.createdAt,
        lastUsedAt: metadata.lastUsedAt,
      });
    } catch (err) {
      void err;
      return c.json({ error: { message: "failed to rotate key", type: "internal_error" } }, 500);
    }
  });

  // Revoke a key.
  app.delete("/:keyId", async (c) => {
    const projectId = c.req.param("id");
    const keyId = c.req.param("keyId");
    if (!projectId || !keyId) {
      return c.json({ error: { message: "project id and key id required", type: "validation_error" } }, 400);
    }
    const ok = await store.revoke(projectId, keyId);
    if (!ok) {
      // Same shape as "not found". Do not leak cross-project existence.
      return c.json({ error: { message: "key not found", type: "not_found" } }, 404);
    }
    return c.json({ deleted: true });
  });

  return app;
}
