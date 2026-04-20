# Git-linked regressions

Every trace records the commit SHA, branch, and dirty flag of the checkout
that produced it. The `/commits` dashboard groups traces by commit and
highlights regressions against the previous commit.

## What gets captured

The SDK runs three `git` subprocesses on first trace creation per process
(cached thereafter):

- `git rev-parse HEAD` → `gitCommit`
- `git rev-parse --abbrev-ref HEAD` → `gitBranch`
- `git status --porcelain` → `gitDirty` (true if the output is non-empty)

If `git` isn't on PATH or the process isn't inside a checkout, all three
fields are `null` — no errors, just no git context.

### Opting out

```typescript
const tl = new Pathlight({
  baseUrl: "http://localhost:4100",
  disableGitContext: true,
});
```

## Database

Migration 0002 adds three columns to `traces`:

| Column | Type | Purpose |
| --- | --- | --- |
| `git_commit` | text | Full SHA |
| `git_branch` | text | Short ref name |
| `git_dirty` | integer (boolean) | Uncommitted changes at run time |

Re-run migrations after upgrading:

```bash
DATABASE_URL="file:$(pwd)/packages/collector/pathlight.db" \
  npm run db:migrate -w packages/db
```

## Dashboard

### Commit badge

Every trace row in the list shows a commit pill with short SHA and branch.
Dirty commits get an amber tint. Hover shows the full SHA.

### `/?commit=<sha>` filter

Clicking a commit row on `/commits` (or typing the query param yourself)
filters the trace list to only runs from that commit. A removable chip
appears next to the search box.

### `/commits` page

`GET /v1/traces/commits` returns rows grouped by `(git_commit, git_branch,
git_dirty)` with aggregate stats:

```json
{
  "commits": [
    {
      "commit": "9ec59ba...",
      "branch": "master",
      "dirty": false,
      "traceCount": 12,
      "avgDuration": 3450.2,
      "avgTokens": 860.5,
      "avgCost": 0.0032,
      "failed": 0,
      "firstSeen": 1745112340000,
      "lastSeen": 1745114210000
    }
  ]
}
```

The UI orders rows newest-first (by `lastSeen`) and computes a delta for
each row against the next older row. Deltas are expressed as percent
changes.

### Regression highlighting

A row gets a red tint if any of:

- Average duration regressed by >25%
- Average tokens regressed by >25%
- Average cost regressed by >25%
- `failed > 0`

The 25% threshold is hard-coded in `apps/web/src/app/commits/page.tsx`
(`REGRESSION_PCT`). Drop it lower if your pipeline is stable; raise it if
small per-commit datasets produce noise.

## Query parameters on `/v1/traces/commits`

| Param | Purpose |
| --- | --- |
| `projectId` | Limit to one project |
| `name` | Limit to one trace name (e.g. `estimate`) — essential when multiple agents share a project |
| `limit` | Max rows (default 20, cap 100) |

## Pairing with trace diff

Seeing a red row in `/commits` answers "which commit regressed?" Clicking
through to `/?commit=<sha>` gives you the specific runs. Then multi-select
one of those plus a good run from the previous commit and hit **Compare**
to see which spans got slower or more expensive.

This is the main observability-driven debugging workflow Pathlight is built
around.

## Limitations

- The commit is captured once per SDK process, so a long-running agent
  process that outlives a deploy will keep attributing traces to the commit
  it started on. Restart the process to pick up a new SHA.
- Per-trace commit is metadata only — it doesn't actually run your code at
  that commit. "Replay against commit X" is a future feature.
