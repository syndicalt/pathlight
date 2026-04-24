# fix-bisect-regression

Walkthrough of git-based bisect: find the regression commit across a range, then propose a fix against it.

## Prerequisites

1. Pathlight stack running: `docker compose up -d` from the repo root.
2. A failing trace in the collector (see `examples/fix-hello-world/` for how to produce one).
3. Two SHAs in your repo:
   - A **known-good** SHA where the failure does NOT reproduce.
   - A **known-bad** SHA where the failure DOES reproduce.
4. A read-only PAT / fine-grained token with `contents: read` on the repo.
5. A BYOK LLM key:
   ```bash
   export PATHLIGHT_LLM_API_KEY=sk-ant-...
   export PATHLIGHT_GIT_TOKEN=ghp_...     # read-only
   ```

## Run

```bash
pathlight fix <trace-id> \
  --bisect \
  --from <good-sha> \
  --to <bad-sha> \
  --git-url https://github.com/<owner>/<repo>.git
```

What you'll see on stderr:

```
# fetching trace...
# cloning repo (shallow, token redacted)...
# bisecting (depth 1) at <sha-1>
# bisecting (depth 2) at <sha-2>
...
# regression found at <sha-N>
# reading source (<k> files)...
# calling anthropic claude-opus-4-7...
# parsing diff...
```

And on stdout: the unified diff, proposed against the regression SHA.

## What it proves

- Bisect completes in O(log₂ N) probes. For a range of 16 commits, that's ≤ 4 probe calls plus 2 endpoint validations.
- The git token is never printed, logged, or included in any error — try passing `--git-url https://bad.example/nope.git` and verify the error message does not contain your token.
- The fix is proposed against the regression SHA's parent state, so applying it won't conflict with downstream commits unless those commits also touch the regressed code.

## Applying the fix

Once you have the proposed diff, check out the regression SHA (or your feature branch that includes it) and apply:

```bash
git checkout <regression-sha>
pathlight fix <trace-id> --bisect --from <good-sha> --to <bad-sha> --git-url <url> > /tmp/fix.patch
git apply /tmp/fix.patch
```

Or let the CLI do it in local-path mode after you've identified the regression SHA:

```bash
git checkout <regression-sha>
pathlight fix <trace-id> --source-dir . --apply
```
