import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bisect, listCommitRange, parentOf } from "./bisect.js";
import { containsAnySecret, redact } from "./secrets.js";

function git(args: string[], cwd: string): string {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout.trim();
}

describe("bisect", () => {
  let repo: string;
  let shas: string[];
  const COMMIT_COUNT = 16;
  const REGRESSION_INDEX = 9;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "pathlight-bisect-test-"));
    git(["init", "-q", "-b", "main"], repo);
    shas = [];
    for (let i = 0; i < COMMIT_COUNT; i++) {
      writeFileSync(join(repo, "x"), `commit ${i}\n`);
      git(["add", "x"], repo);
      git(["commit", "-q", "-m", `c${i}`], repo);
      shas.push(git(["rev-parse", "HEAD"], repo));
    }
  });

  afterAll(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
  });

  it("lists the commit range oldest → newest (exclusive of from)", async () => {
    const range = await listCommitRange(repo, shas[0]!, shas[COMMIT_COUNT - 1]!);
    expect(range).toEqual(shas.slice(1));
  });

  it("resolves parent of a commit", async () => {
    const parent = await parentOf(repo, shas[5]!);
    expect(parent).toBe(shas[4]!);
  });

  it("finds the regression at the expected index in O(log n) probes", async () => {
    let calls = 0;
    const result = await bisect(repo, {
      from: shas[0]!,
      to: shas[COMMIT_COUNT - 1]!,
      probe: async (sha) => {
        calls++;
        const idx = shas.indexOf(sha);
        return idx >= REGRESSION_INDEX ? "bad" : "good";
      },
    });
    expect(result.regressionSha).toBe(shas[REGRESSION_INDEX]!);
    expect(result.parentSha).toBe(shas[REGRESSION_INDEX - 1]!);
    // 16 commits -> ~log2(16)=4 probes plus 2 endpoint validations = ~6 total.
    expect(calls).toBeLessThanOrEqual(8);
    expect(result.iterations).toBe(calls);
  });

  it("throws if the --to endpoint is not bad", async () => {
    await expect(
      bisect(repo, {
        from: shas[0]!,
        to: shas[COMMIT_COUNT - 1]!,
        probe: async () => "good",
      }),
    ).rejects.toThrow(/did not reproduce the failure/);
  });

  it("throws if the --from endpoint is already bad", async () => {
    await expect(
      bisect(repo, {
        from: shas[0]!,
        to: shas[COMMIT_COUNT - 1]!,
        probe: async () => "bad",
      }),
    ).rejects.toThrow(/already reproduces the failure/);
  });
});

describe("secrets redaction", () => {
  it("redact() replaces every occurrence of every known secret", () => {
    const token = "ghp_verysecret1234";
    const key = "sk-ant-verysecret5678";
    const msg = `cloning https://x-access-token:${token}@github.com/a/b (key prefix: ${key.slice(0, 12)})`;
    const out = redact(msg, token, key);
    expect(out).not.toContain(token);
    expect(out).toContain("[REDACTED]");
  });

  it("redact() scrubs x-access-token:<token>@ URL shape even without the literal secret", () => {
    const out = redact("fetching https://x-access-token:arbitrarytoken@github.com/a/b");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("arbitrarytoken");
  });

  it("redact() ignores empty / too-short secrets (no accidental mass-replace)", () => {
    const out = redact("hello world", "", null, undefined, "ab");
    expect(out).toBe("hello world");
  });

  it("containsAnySecret() detects a leaked token literal", () => {
    const token = "ghp_verysecret1234";
    expect(containsAnySecret(`error: ${token} invalid`, token)).toBe(true);
    expect(containsAnySecret("error: redacted", token)).toBe(false);
  });
});
