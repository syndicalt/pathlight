import { afterEach, describe, expect, it } from "vitest";
import { createFixApplyRoutes } from "../src/routes/fix-apply.js";

const originalRoots = process.env.PATHLIGHT_FIX_APPLY_ROOTS;

afterEach(() => {
  if (originalRoots === undefined) delete process.env.PATHLIGHT_FIX_APPLY_ROOTS;
  else process.env.PATHLIGHT_FIX_APPLY_ROOTS = originalRoots;
});

async function call<T = unknown>(body: unknown): Promise<{ status: number; body: T }> {
  const app = createFixApplyRoutes();
  const res = await app.fetch(
    new Request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as T };
}

describe("POST /v1/fix-apply", () => {
  it("rejects missing sourceDir", async () => {
    const res = await call<{ error: { type: string } }>({ diff: "diff" });
    expect(res.status).toBe(400);
    expect(res.body.error.type).toBe("validation_error");
  });

  it("rejects missing diff", async () => {
    const res = await call<{ error: { type: string } }>({ sourceDir: "/tmp/project" });
    expect(res.status).toBe(400);
    expect(res.body.error.type).toBe("validation_error");
  });

  it("rejects sourceDir outside PATHLIGHT_FIX_APPLY_ROOTS before running git", async () => {
    process.env.PATHLIGHT_FIX_APPLY_ROOTS = "/tmp/pathlight-allowed";
    const res = await call<{ error: { message: string; type: string } }>({
      sourceDir: "/tmp/not-allowed",
      diff: "diff --git a/a b/a\n",
    });

    expect(res.status).toBe(403);
    expect(res.body.error.type).toBe("source_dir_not_allowed");
    expect(res.body.error.message).toBe("sourceDir is outside PATHLIGHT_FIX_APPLY_ROOTS");
  });

  it("allows nested sourceDir values inside PATHLIGHT_FIX_APPLY_ROOTS", async () => {
    process.env.PATHLIGHT_FIX_APPLY_ROOTS = "/tmp/pathlight-allowed";
    const res = await call<{ error: { type: string } }>({
      sourceDir: "/tmp/pathlight-allowed/project",
      diff: "not a valid diff",
    });

    expect(res.status).toBe(409);
    expect(res.body.error.type).toBe("apply_precheck_failed");
  });
});
