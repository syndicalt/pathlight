# Leak audit checklist — @pathlight/keys

Run this checklist before every release of `@pathlight/keys` and before any change that touches a key-handling code path. The five items below are the canonical invariants from parent issue #44.

## The five invariants

1. **Never store plaintext.** Every write path runs through `seal()` before `INSERT`.
2. **Never log secrets.** Not in `console.*`, not in thrown errors, not in trace emission, not in HTTP response bodies.
3. **Never return plaintext from any endpoint.** The only path that returns plaintext is `KeyStore.resolveSecret` / the `SecretResolver` adapter, and those are internal callers (never response bodies).
4. **Fail-stop on missing `PATHLIGHT_SEAL_KEY`.** No default, no fallback.
5. **Cross-project access returns `null`.** Same shape as not-found so callers can't probe which IDs exist elsewhere.

## Grep audit (run at each release)

Run these commands from the repo root. **Zero unexpected hits is the bar.**

### 1. No plaintext field escapes the store boundary

```bash
grep -rnE "sealedValue|sealed_value" packages/ apps/
```

Expected: only appears in
- `packages/db/src/schema.ts` (column definition)
- `packages/keys/src/store.ts` (write path in `create()`; read path in `resolveSecret()`)
- `packages/keys/src/store.ts` docstrings and internal `toMetadata()` exclusion comment
- Tests that explicitly verify the string is NOT in response bodies

**Must NOT appear in:** route handlers' response objects, UI components, trace emission paths, log statements, error message strings.

### 2. No `console.*` with plaintext

```bash
grep -rnE "console\.(log|error|warn|debug|info)" packages/keys/ packages/collector/src/routes/keys.ts apps/web/src/app/settings/keys/
```

Expected hits are only inside *string literals* that give the user a command to run (e.g. the key-generation hint in `seal-key.ts`). **No `console.log(plaintext)` patterns.**

### 3. Error paths never include the input value

```bash
grep -nE "throw new|c\.json.*error" packages/collector/src/routes/keys.ts
```

Every error message must be a static string or composed of non-secret fields (`kind`, `label`, field names). No concatenation of `value`, `plaintext`, `token`, or `apiKey` into error text.

### 4. Route responses enumerate fields explicitly

```bash
grep -nE "c\.json\(" packages/collector/src/routes/keys.ts
```

Every success response on this route must build its object literal with explicit keys. **No spread operator on a store record** — a future schema addition named `sealedValue` or similar would otherwise leak via `JSON.stringify`.

### 5. UI never reads plaintext back

```bash
grep -rnE "(fetch|axios|http).*value" apps/web/src/app/settings/keys/
```

The UI never requests the plaintext after creation. The only `value` reference should be the input field that sends new plaintext into `POST` / `PUT`, never into `GET`.

### 6. Seal key is only loaded from env, fail-stop

```bash
grep -rnE "PATHLIGHT_SEAL_KEY|loadSealKey|SealKeyError" packages/ apps/
```

Expected: only `packages/keys/src/seal-key.ts` reads the env var. `packages/collector/src/index.ts` calls `loadSealKey()` inside a try/catch that `process.exit(1)`s on `SealKeyError`.

## Runtime probes

These should pass automatically in CI via the integration tests, but verify manually for releases.

### A. Response bodies never contain plaintext

The integration tests in `packages/collector/tests/keys.test.ts` include:

```ts
expect(JSON.stringify(res.body)).not.toContain("sk-ant-api-secret-abcd1234");
expect(JSON.stringify(res.body)).not.toContain("sealedValue");
expect(JSON.stringify(res.body)).not.toContain("sealed_value");
```

These tests use realistic plaintext values (long enough that an accidental substring match is vanishingly unlikely) and assert absence across the lifecycle (create → list → rotate → delete).

### B. Cross-project scoping

`DELETE /v1/projects/<other>/keys/<id>` on a key belonging to a different project returns the same 404 shape as a truly missing key. The integration test `"returns 404 on cross-project delete (same shape as not-found)"` verifies this.

### C. Kind filtering on the resolver

`resolveLlmKey` on a `git`-kind key returns `null`; `resolveGitToken` on an `llm`-kind key returns `null`. See `packages/keys/src/resolver.test.ts`.

### D. Decryption failure is opaque

Pass corrupt ciphertext to `unseal()` — must throw `DecryptionError` with a generic message (no detail about what failed, no bytes echoed).

## When a new code path lands

Before merging any PR that touches `@pathlight/keys`, `packages/collector/src/routes/keys.ts`, or `apps/web/src/app/settings/keys/`:

1. Run the six greps above. Audit any new hits.
2. Run `npx vitest run packages/keys packages/collector/tests/keys.test.ts` — all existing probes must still pass.
3. If the change adds a new field to the response, verify the explicit-field-enumeration rule (item 4) still holds.
4. If the change adds a new error path, verify it produces a static message (item 3).
5. If the change adds a new module that reads plaintext, extend this audit doc with the appropriate greps.

## Known limitations (documented, not blockers for v1)

- **Master-key rotation**: there is no automated re-seal flow if `PATHLIGHT_SEAL_KEY` must change. Operators must dump, re-seal, reload — see follow-up ops doc.
- **Auth scope**: project scoping is enforced on every path, but there is no user/session auth above the project layer today. When auth lands, revisit whether `projectId` alone is sufficient ACL.
- **Encrypted backups**: backups of `pathlight.db` contain the sealed ciphertext. They are safe as long as `PATHLIGHT_SEAL_KEY` is not stored alongside. Document this in deployment guides.
