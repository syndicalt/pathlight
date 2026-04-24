/**
 * SecretResolver adapter that backs the interface consumed by P3's
 * `POST /v1/fix` route (see packages/collector/src/routes/fix-secret-resolver.ts
 * on the #47 branch) with a KeyStore.
 *
 * This is the production resolver. It enforces the parent invariants:
 *   - Plaintext is returned ONLY from `resolveLlmKey` / `resolveGitToken`.
 *   - Cross-project access returns `null` (same shape as not-found — the
 *     route converts either into a generic 403, so callers can't probe).
 *   - The resolver NEVER logs the secret or the keyId+plaintext pair.
 *   - `kind` filtering: an `llm` key can only be resolved via
 *     `resolveLlmKey`; a `git` key only via `resolveGitToken`. Mismatches
 *     return `null` so a caller who accidentally passes a git token ID to
 *     the LLM resolver gets a lookup miss, not a mis-typed secret.
 *
 * To wire into the collector (once #47 and #48 both merge), replace the
 * env-backed stub in #47's route setup with:
 *
 *   import { KeyStore, createKeyStoreSecretResolver } from "@pathlight/keys";
 *   const resolver = createKeyStoreSecretResolver(keyStore);
 *   // pass `resolver` where the route currently takes createEnvSecretResolver()
 */

import type { KeyStore } from "./store.js";

export interface SecretResolver {
  resolveLlmKey(projectId: string, keyId: string): Promise<string | null>;
  resolveGitToken(projectId: string, tokenId: string): Promise<string | null>;
}

export function createKeyStoreSecretResolver(store: KeyStore): SecretResolver {
  return {
    async resolveLlmKey(projectId, keyId) {
      const meta = await store.getMetadata(projectId, keyId);
      if (!meta || meta.kind !== "llm") return null;
      return store.resolveSecret(projectId, keyId);
    },
    async resolveGitToken(projectId, tokenId) {
      const meta = await store.getMetadata(projectId, tokenId);
      if (!meta || meta.kind !== "git") return null;
      return store.resolveSecret(projectId, tokenId);
    },
  };
}
