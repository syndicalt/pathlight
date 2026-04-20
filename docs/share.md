# Sharing traces

See [packages/cli/README.md](../packages/cli/README.md) for the full
`pathlight share` reference.

## TL;DR

```bash
pathlight share <trace-id> --out ./bug-report.html
```

Produces a single self-contained HTML file. Open in any browser — no
Pathlight, no server, no dependencies. Perfect for attaching to a GitHub
issue or Slack thread.

## Redaction

Sanitize inputs / outputs / errors before sharing:

```bash
pathlight share <trace-id> \
  --redact-input \
  --redact-output \
  --redact-errors \
  --out safe-for-sharing.html
```

Redacted fields are replaced with the literal string `"[redacted]"` in the
embedded JSON; everything else (timings, span structure, metadata, git
provenance) is preserved.

## What's in the file

- Summary card strip: duration, span count, tokens, cost
- Trace input / output (formatted JSON)
- Waterfall timeline with clickable `<details>` elements that expand to
  show per-span input / output / error
- Git provenance chip (commit SHA + branch) if captured
- "Exported at" footer

No network calls. No tracking. No telemetry. One file, local-first.

## See also

- [packages/cli/README.md](../packages/cli/README.md) — full CLI options
- [docs/trace-diff.md](trace-diff.md) — if both you and the recipient have
  Pathlight, prefer sending two trace IDs and letting the recipient run
  `/traces/compare?a=…&b=…` — higher-fidelity than static HTML.
