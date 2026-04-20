# Trace diff

Side-by-side comparison of two traces. Built for the question "did my prompt
change break anything?"

## Usage

1. Open the trace list.
2. Hover any row — a checkbox appears on the left. Click to select.
3. Select a second row. A floating **Compare →** action bar appears.
4. Click Compare. The page routes to `/traces/compare?a=<idA>&b=<idB>`.

You can also navigate directly to `/traces/compare?a=…&b=…` with any two
trace IDs.

## What you see

### Trace headers (top)

Side A (red badge) and side B (emerald badge). Each shows the trace name,
status dot, short id, and key metrics (duration, tokens, span count).
Clicking the name opens the full trace detail in a new context.

### Summary delta bar

Single-line summary of how B compares to A:

- **Duration** — percent change
- **Tokens** — percent change
- **Cost** — percent change
- **Span count** — raw count change

Positive deltas show amber (worse); negative show emerald (better). Deltas
<1% render muted since they're noise.

### Trace input / output diff

Pretty-printed JSON with a line-level LCS diff. Added lines are emerald,
removed lines are red, unchanged lines muted. If A and B are byte-identical,
the diff view collapses to a single muted preview.

### Aligned spans

LCS alignment on span names produces pairs:

- Both sides present → row shows both span cards plus the per-pair duration delta between them
- A only → row tinted red, B cell says "(removed in B)"
- B only → row tinted emerald, A cell says "(added in B)"

Clicking any row with both sides present expands inline to show per-span
input and output JSON diffs.

## Algorithm

Span alignment uses classic Longest Common Subsequence on the list of span
names. This gracefully handles:

- Spans added/removed between versions
- Spans reordered (best-effort — drastic reordering produces a degraded
  alignment but never crashes)
- Identical traces (every pair aligns; every diff shows "unchanged")

Line diff for JSON bodies is the same LCS implementation applied to pretty-
printed text. Implementation lives in `apps/web/src/lib/diff.ts` — ~50 lines,
zero dependencies.

## Limitations

- LCS on names can't match a renamed span to its counterpart. If a span's
  name changes between runs, it'll appear as one removed and one added.
- Line-level diff isn't semantic — re-ordering keys in a JSON object will
  show as a delete+add pair even though the values are unchanged. Good
  enough for 95% of cases; semantic JSON diff is a future improvement.
- No support yet for comparing more than two traces. A matrix view is
  doable but hasn't been needed.
