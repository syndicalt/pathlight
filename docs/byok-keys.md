# BYOK key storage

Encrypted-at-rest storage for the LLM API keys and git read-only tokens the code-fixing agent uses from the dashboard. Library and CLI callers still pass keys directly (via env vars or function arguments); the key store exists so the dashboard can drive fix runs without ever holding plaintext in the browser.

## Enable

Set a 32-byte base64 master key before starting the collector:

```bash
# Generate once, store somewhere safe (password manager, secrets manager)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Set on the collector process
export PATHLIGHT_SEAL_KEY=<the-base64-value>
docker compose up -d   # or `npx turbo dev`
```

When `PATHLIGHT_SEAL_KEY` is set the collector loads [`@pathlight/keys`](../packages/keys) and mounts `/v1/projects/:id/keys`. When it's absent the endpoints simply aren't mounted — existing deployments without BYOK keep working.

The collector **fail-stops** (`process.exit(1)`) if `PATHLIGHT_SEAL_KEY` is present but malformed. No default fallback, no insecure generation.

## Manage keys

Open `http://localhost:3100/settings/keys`:

1. Enter a project ID (free-text for now; will come from session auth once auth lands).
2. Click **Add a key** — pick kind (LLM key or git token), provider (anthropic / openai / github / etc.), label, and paste the value.
3. Rotate inline per row; revoke removes the row immediately.

Every displayed value is masked to `••••••••<last-4>`. The plaintext is never shown after creation — if you lose it, rotate.

## How the dashboard uses stored keys

When you hit "Fix this" on a failing span, the fix dialog's **Provider + key picker** fetches `/v1/projects/:id/keys`, filters by `kind` + `provider`, and renders a `<select>` of your stored keys. You pick one by ID — the browser never sees the plaintext; the collector resolves the ID → plaintext internally at the moment of the outbound LLM call, and forgets it immediately.

## Security invariants

Enforced at every write path and audited via [`packages/keys/LEAK-AUDIT.md`](../packages/keys/LEAK-AUDIT.md):

1. **Plaintext is NEVER stored.** Every write goes through `seal()` before `INSERT`.
2. **Plaintext is NEVER logged.** Not in `console.*`, not in errors, not in HTTP response bodies, not in Pathlight traces.
3. **Endpoints NEVER return plaintext.** `POST` returns masked metadata; `GET` lists are metadata-only; `PUT` (rotate) returns the new masked metadata. The only path that returns plaintext is the internal `resolveSecret`, and it's per-project scoped.
4. **Fail-stop on missing/malformed `PATHLIGHT_SEAL_KEY`.** No default, no fallback, no insecure generation.
5. **Constant-time opaque failure.** Corrupt ciphertext throws a generic `DecryptionError` with no detail.
6. **Cross-project access returns `null`.** Same response shape as not-found so callers cannot probe which IDs exist under other projects.
7. **Kind filtering on the resolver.** `resolveLlmKey` only returns keys with `kind: "llm"`; `resolveGitToken` only returns `kind: "git"`. Cross-kind access gets `null` — no mis-typed secrets flowing into the wrong API.

## Cryptography

- Primitive: libsodium `crypto_secretbox_easy` (authenticated encryption).
- Nonce: fresh random per value (`crypto_secretbox_NONCEBYTES`, stored packed with ciphertext).
- Key: 32 bytes from `PATHLIGHT_SEAL_KEY`, validated at load time.
- No master-key rotation automation in v1 — documented as an ops follow-up.

## Endpoints

| Endpoint | Method | Description |
| --- | --- | --- |
| `/v1/projects/:id/keys` | GET | List keys (masked metadata only) |
| `/v1/projects/:id/keys` | POST | Create a key. Body: `{ kind, provider, label, value }`. Returns masked metadata. |
| `/v1/projects/:id/keys/:keyId` | PUT | Rotate atomically (create new + delete old in a transaction). Returns new masked metadata. |
| `/v1/projects/:id/keys/:keyId` | DELETE | Revoke immediately. |

Responses never include the plaintext, even after `POST`. If you need the raw value, you need to know it at creation time — it doesn't leave the server round-trip for later retrieval.

## Backups

Database backups (`pathlight.db`) contain the sealed ciphertext. Safe as long as `PATHLIGHT_SEAL_KEY` lives separately (not in the same backup bundle). Document this in your deploy runbook.

## Known limitations (v1)

- **No automated master-key rotation.** Changing `PATHLIGHT_SEAL_KEY` invalidates all stored ciphertext. Rotation requires dump + re-seal + reload.
- **Per-project scoping only.** When auth lands, revisit whether `projectId` alone is the right ACL — user/session scoping will probably layer on top.
- **Manual project ID entry in the UI.** Current behavior; comes from session context once auth is added.

## Package

[`packages/keys`](../packages/keys) in this repo; not published to npm (internal package).
