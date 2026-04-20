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
