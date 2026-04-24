# Docker deployment

Self-host Pathlight with a single command.

```bash
git clone https://github.com/syndicalt/pathlight.git
cd pathlight
docker compose up -d
```

Dashboard at <http://localhost:3100>, collector at <http://localhost:4100>.

## What you get

Two services:

| Service | Port | Image |
| --- | --- | --- |
| `collector` | 4100 | `ghcr.io/syndicalt/pathlight-collector:latest` |
| `web` | 3100 | `ghcr.io/syndicalt/pathlight-web:latest` |

Plus a named volume `pathlight_data` holding the SQLite file — data
survives container restarts and Pathlight upgrades.

## First startup

`docker compose up -d` pulls the prebuilt images from GHCR (typically
under 30 seconds), starts the collector, waits for its health check to
pass, then starts the dashboard once the collector is ready.

Migrations run automatically on collector startup, so fresh installs
are provisioned without any manual `db:migrate` step.

## LLM replay

To enable in-dashboard prompt replay, set one or both provider API keys:

```bash
OPENAI_API_KEY=sk-…  docker compose up -d
# or
ANTHROPIC_API_KEY=sk-ant-…  docker compose up -d
```

Uncomment the matching lines in the `environment:` block of
`docker-compose.yml` to persist them.

## BYOK key storage (`PATHLIGHT_SEAL_KEY`)

To enable the dashboard's encrypted key store (`/settings/keys`) and the
`/v1/projects/:id/keys` endpoints — required for the **dashboard's "Fix this"
flow** to resolve a sealed key without ever putting plaintext in the browser —
set a 32-byte base64 master key on the collector before first start:

```bash
# 1. Generate a key. Store it somewhere safe (password manager, secrets manager).
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# → gf9XHIThUBjcr75wiXmS48KVA9oWNOim1lwELGnxfLE=

# 2. Add it to .env (gitignored) at the repo root
echo "PATHLIGHT_SEAL_KEY=gf9XHIThUBjcr75wiXmS48KVA9oWNOim1lwELGnxfLE=" >> .env

# 3. Restart the stack so the collector picks it up
docker compose down
docker compose up -d
```

`docker-compose.yml` already passes `PATHLIGHT_SEAL_KEY` through to the
collector container — the env var just needs to exist in the shell or `.env`
when you run `docker compose up`.

**Behavior:**

- When `PATHLIGHT_SEAL_KEY` is set, the collector mounts
  `/v1/projects/:id/keys` and the BYOK key picker in the dashboard
  becomes functional.
- When it's absent, the endpoints aren't mounted, the picker shows an
  empty-state link, and users fall back to the fallback raw-text inputs
  (or the CLI, which uses env vars instead of the store).
- If the value is malformed (not exactly 32 bytes after base64 decode), the
  collector **fail-stops** at boot — no insecure default, no fallback.

**Backups:** `pathlight.db` (in the `pathlight_data` volume) holds the sealed
ciphertext. Safe as long as `PATHLIGHT_SEAL_KEY` lives **separately** from the
backup (different secrets bundle, different password-manager vault). Document
this in your operations runbook.

See [docs/byok-keys.md](byok-keys.md) for the full API, security invariants,
and rotation guidance.

## Custom collector URL

By default the dashboard talks to `http://localhost:4100`. If you're
running the collector on a different host, build the dashboard image
with a matching `NEXT_PUBLIC_COLLECTOR_URL`:

```bash
NEXT_PUBLIC_COLLECTOR_URL=https://traces.example.com docker compose up -d --build
```

`NEXT_PUBLIC_*` env vars are baked in at Next.js build time, so any
change requires rebuilding the web image.

## Upgrading

```bash
docker compose pull
docker compose up -d
```

Migrations are applied idempotently on collector startup.

## Resetting

```bash
docker compose down -v   # removes the volume too
```

## Building locally

If you're hacking on Pathlight and want to build from source instead
of pulling from GHCR:

```bash
docker compose up -d --build
```

The first build is ~2 minutes (Next.js standalone compile dominates).
Subsequent builds reuse cached layers.

## Image sizes

| Image | Compressed | Uncompressed |
| --- | --- | --- |
| `pathlight-collector` | ~70MB | ~200MB |
| `pathlight-web` | ~60MB | ~180MB |

Both images inherit from `node:22-slim`. Switching to `node:22-alpine`
would cut ~60MB per image but requires extra glibc shimming for
`better-sqlite3` — left as a future optimization.
