# @pathlight/cli

Command-line utilities for [Pathlight](https://github.com/syndicalt/pathlight).

Two subcommands:

- **`pathlight share`** — single-file HTML snapshot of a trace, zero deps to open
- **`pathlight fix`** — BYOK code-fixing agent that reads a failing trace, pulls
  source, and prints a unified diff (CLI mirror of the dashboard's "Fix this"
  flow)

## Install

```bash
npm install -g @pathlight/cli
# or run ad-hoc
npx @pathlight/cli <subcommand> [args]
```

---

## `pathlight share`

Export a single-file HTML snapshot of a trace. Perfect for attaching to bug
reports, PR comments, or incident channels — the recipient doesn't need
Pathlight installed, there are no network calls, and the file opens in any
browser.

```bash
pathlight share abc123def --out ./bug-report.html
```

### Options

| Flag                | Default                                  | Purpose                                   |
| ------------------- | ---------------------------------------- | ----------------------------------------- |
| `--base-url <url>`  | `$PATHLIGHT_URL` or `http://localhost:4100` | Collector URL                          |
| `--out <path>`      | `./pathlight-<id>.html`                  | Output file path                          |
| `--redact-input`    |                                          | Replace input / toolArgs with `[redacted]`|
| `--redact-output`   |                                          | Replace output / toolResult               |
| `--redact-errors`   |                                          | Replace error messages                    |

### What's in the file

Trace metadata, all spans (waterfall + per-span JSON), input/output, events, and
git provenance if captured. No scripts other than the vanilla rendering logic —
it's safe to send across security boundaries.

---

## `pathlight fix`

BYOK code-fixing agent. Reads a failing trace from your collector, pulls the
source files the trace's spans referenced (via `_source.file` metadata), and
asks an LLM (Anthropic or OpenAI, your key) to propose a unified diff.

The same engine powers the dashboard's "Fix this" button — the CLI is the
headless / CI surface.

### Quick start

```bash
# Set your BYOK LLM key once per shell
export PATHLIGHT_LLM_API_KEY=sk-ant-...    # or sk-... for OpenAI

# Path mode — read source from a local checkout (default mode)
pathlight fix trc_xxx --source-dir .

# Apply the proposed diff to the working tree (runs `git apply --check` first)
pathlight fix trc_xxx --source-dir . --apply

# Pipe the diff into your own review workflow
pathlight fix trc_xxx --source-dir . > /tmp/fix.patch
git checkout -b fix/trc_xxx
git apply /tmp/fix.patch
```

Progress events go to **stderr** (`# fetching trace`, `# reading 3 source files`,
`# calling anthropic claude-opus-4-7`); the diff goes to **stdout** so piping
works cleanly.

### Git mode (no local checkout required)

```bash
export PATHLIGHT_LLM_API_KEY=sk-ant-...
export PATHLIGHT_GIT_TOKEN=ghp_...        # read-only PAT

pathlight fix trc_xxx \
  --git-url https://github.com/acme/repo.git \
  --git-ref main
```

The engine does a shallow clone (`depth=1`) into a tempdir, checks out the ref,
and cleans up on exit. Tokens never hit disk and are scrubbed from any error
output.

### Bisect mode (find the regression commit)

```bash
pathlight fix trc_xxx \
  --bisect \
  --from <known-good-sha> \
  --to <known-bad-sha> \
  --git-url https://github.com/acme/repo.git
```

Binary-searches the commit range — `O(log₂ N)` probe calls for `N` commits —
and returns the regression SHA plus a fix proposed against that commit.

The bisect endpoints are validated first: if `from` actually reproduces the
failure or `to` doesn't, the engine bails with an explanation rather than
silently picking the wrong SHA.

### Options

| Flag | Default | Purpose |
| --- | --- | --- |
| `--source-dir <path>` | — | Path mode — read source from local dir |
| `--git-url <url>` | — | Git mode — clone + read source |
| `--git-ref <ref>` | `HEAD` | Git ref to check out (mode: git/bisect) |
| `--bisect` | off | Switch to bisect mode (requires `--from`, `--to`, `--git-url`) |
| `--from <sha>` | — | Known-good SHA (bisect mode) |
| `--to <sha>` | — | Known-bad SHA (bisect mode) |
| `--mode <span\|trace>` | `span` | Which span(s) to fix (ignored in bisect) |
| `--provider <anthropic\|openai>` | `anthropic` | LLM provider |
| `--model <id>` | provider default | Override the model |
| `--apply` | off | Run `git apply` on the diff (path mode only) |
| `--base-url <url>` | `$PATHLIGHT_URL` or `http://localhost:4100` | Collector URL |

### Required env

| Variable | Required for | Notes |
| --- | --- | --- |
| `PATHLIGHT_LLM_API_KEY` | every `pathlight fix` call | Anthropic `sk-ant-…` or OpenAI `sk-…` |
| `PATHLIGHT_GIT_TOKEN` | `--git-url` and `--bisect` | Read-only PAT; never logged |
| `PATHLIGHT_URL` | optional | Collector URL (defaults to `http://localhost:4100`) |

### Defaults per provider

| Provider | Default model |
| --- | --- |
| `anthropic` | `claude-opus-4-7` |
| `openai`    | `gpt-5.4` |

Override per call with `--model <id>`.

### CI patterns

```yaml
# .github/workflows/agent-regressions.yml
- name: Auto-propose fix on failed run
  if: failure()
  env:
    PATHLIGHT_URL: ${{ secrets.PATHLIGHT_URL }}
    PATHLIGHT_LLM_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    pathlight fix "$LATEST_FAILED_TRACE_ID" --source-dir . > fix.patch
    if [ -s fix.patch ]; then
      gh pr comment "$PR_NUMBER" --body "$(printf '%s\n```diff\n%s\n```' \
        'Pathlight proposed a fix for the failing trace:' "$(cat fix.patch)")"
    fi
```

### Security

- BYOK end-to-end. Pathlight never proxies your LLM traffic and never stores
  the keys you pass to the CLI.
- `PATHLIGHT_LLM_API_KEY` and `PATHLIGHT_GIT_TOKEN` are scrubbed from every
  error-path string before printing.
- Each invocation emits a `fix.engine` meta-trace to your collector. The
  meta-trace carries mode, provider, model, token counts, and files changed —
  but **never** the diff body, the explanation, the API key, or the git token.
- `--git-url` requires read-only tokens. The CLI does not push, branch, or
  open PRs in v1.

### Try it without writing your own bug

The repo ships an example agent and a seed script that produces a failing
trace and demo files matched to its `_source.file` metadata:

```bash
# From the repo root, with a Pathlight stack running
node scripts/seed-screenshots.mjs   # creates a project + failing trace
# Copy the printed "Fix-engine demo trace" id, then:
pathlight fix <printed-trace-id> \
  --source-dir examples/quote-agent
```

You'll see the engine read `examples/quote-agent/src/agents/quote.ts`, identify
the JSON-parsing bug in `composeEstimate`, and emit a diff that tightens the
system prompt and adds a defensive parser.

### See also

- [docs/fix.md](https://github.com/syndicalt/pathlight/blob/master/docs/fix.md)
  — full feature deep-dive (modes, providers, source access, bisect internals)
- [examples/fix-hello-world](https://github.com/syndicalt/pathlight/tree/master/examples/fix-hello-world)
  — minimal end-to-end loop
- [examples/fix-bisect-regression](https://github.com/syndicalt/pathlight/tree/master/examples/fix-bisect-regression)
  — bisect walkthrough
- [docs/byok-keys.md](https://github.com/syndicalt/pathlight/blob/master/docs/byok-keys.md)
  — encrypted key store the dashboard uses (CLI uses env vars instead)
