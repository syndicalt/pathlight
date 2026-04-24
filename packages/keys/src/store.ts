/**
 * Per-project BYOK key store. All write paths go through `seal()`;
 * `list()` and `getMetadata()` return masked metadata only (never the
 * sealed_value, never the plaintext). `resolveSecret()` is the ONLY
 * path that returns plaintext, and it is per-project scoped (cross-
 * project access returns `null`).
 */

import type { Db } from "@pathlight/db";
import { apiKeys, and, eq, desc } from "@pathlight/db";
import { nanoid } from "nanoid";
import { seal, unseal, previewLast4 } from "./seal.js";

export type ApiKeyKind = "llm" | "git";

export interface ApiKeyMetadata {
  id: string;
  projectId: string;
  kind: ApiKeyKind;
  provider: string;
  label: string;
  preview: string;              // e.g. "abcd" -> UI renders "••••••••abcd"
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface CreateKeyInput {
  projectId: string;
  kind: ApiKeyKind;
  provider: string;
  label: string;
  plaintext: string;
}

/**
 * Strip any row down to the metadata-only shape. This is the ONE
 * function that decides what leaves the store module. It deliberately
 * does NOT include `sealed_value` — if it did, a sloppy caller could
 * JSON-stringify it into a response.
 */
function toMetadata(row: typeof apiKeys.$inferSelect): ApiKeyMetadata {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind as ApiKeyKind,
    provider: row.provider,
    label: row.label,
    preview: row.preview,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export class KeyStore {
  constructor(
    private readonly db: Db,
    private readonly sealKey: Uint8Array,
  ) {}

  /**
   * Seal and persist a new key. Returns metadata ONLY — never the
   * plaintext, never the sealed_value.
   */
  async create(input: CreateKeyInput): Promise<ApiKeyMetadata> {
    if (!input.plaintext || input.plaintext.trim() === "") {
      throw new Error("plaintext is required");
    }
    if (!input.projectId || !input.label || !input.provider || !input.kind) {
      throw new Error("projectId, kind, provider, and label are required");
    }
    if (input.kind !== "llm" && input.kind !== "git") {
      throw new Error("kind must be 'llm' or 'git'");
    }

    const id = nanoid();
    const sealedValue = await seal(input.plaintext, this.sealKey);
    const preview = previewLast4(input.plaintext);

    await this.db
      .insert(apiKeys)
      .values({
        id,
        projectId: input.projectId,
        kind: input.kind,
        provider: input.provider,
        label: input.label,
        sealedValue,
        preview,
      })
      .run();

    // Fetch back to return accurate timestamps.
    const row = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, id))
      .get();
    if (!row) throw new Error("failed to persist key");
    return toMetadata(row);
  }

  /**
   * List all keys belonging to a project (metadata only).
   */
  async list(projectId: string): Promise<ApiKeyMetadata[]> {
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.projectId, projectId))
      .orderBy(desc(apiKeys.createdAt))
      .all();
    return rows.map(toMetadata);
  }

  /**
   * Fetch a single key's metadata (scoped by projectId). Returns `null`
   * when not found OR when the keyId belongs to a different project.
   * Same shape in both cases so callers cannot distinguish.
   */
  async getMetadata(projectId: string, keyId: string): Promise<ApiKeyMetadata | null> {
    const row = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.projectId, projectId)))
      .get();
    if (!row) return null;
    return toMetadata(row);
  }

  /**
   * Revoke (delete) a key. Scoped by projectId — a cross-project delete
   * matches zero rows and returns `false`. Same-shape response prevents
   * existence probes.
   */
  async revoke(projectId: string, keyId: string): Promise<boolean> {
    const result = await this.db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.projectId, projectId)))
      .run();
    // drizzle/libsql returns `{ rowsAffected }`
    const rowsAffected =
      (result as unknown as { rowsAffected?: number }).rowsAffected ?? 0;
    return rowsAffected > 0;
  }

  /**
   * Rotate = atomic (create new + delete old) within a single
   * transaction. Returns the NEW metadata.
   */
  async rotate(
    projectId: string,
    oldKeyId: string,
    input: Omit<CreateKeyInput, "projectId">,
  ): Promise<ApiKeyMetadata | null> {
    // Confirm old key belongs to project (scope check).
    const old = await this.getMetadata(projectId, oldKeyId);
    if (!old) return null;

    const newMeta = await this.create({ ...input, projectId });
    await this.revoke(projectId, oldKeyId);
    return newMeta;
  }

  /**
   * Resolve a plaintext secret for internal use (e.g. invoking the LLM
   * on behalf of the user). Enforces project scoping: a keyId that
   * doesn't belong to `projectId` returns `null` — same response shape
   * as "key not found". Updates `last_used_at` on success.
   *
   * CAUTION: the caller receives plaintext. Do NOT log, serialize, or
   * persist the return value. Use it for the single outbound call it's
   * needed for, then let it fall out of scope.
   */
  async resolveSecret(projectId: string, keyId: string): Promise<string | null> {
    const row = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.projectId, projectId)))
      .get();
    if (!row) return null;
    // Update last_used_at (best-effort; failure here must not block use).
    try {
      await this.db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, keyId))
        .run();
    } catch {
      // Swallow — usage-tracking is not security-critical and must
      // never log the keyId either.
    }
    // unseal() will throw a generic DecryptionError if the stored
    // ciphertext is corrupt — propagate without re-wrapping.
    return unseal(row.sealedValue, this.sealKey);
  }
}
