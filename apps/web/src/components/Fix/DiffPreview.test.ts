import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./diff-parser";

describe("parseUnifiedDiff", () => {
  it("parses a standard git diff with additions, removals, and context", () => {
    const files = parseUnifiedDiff(`diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import { run } from "./run";
-run("old");
+run("new");
+run("again");
 console.log("done");
`);

    expect(files).toHaveLength(1);
    expect(files[0].oldPath).toBe("src/app.ts");
    expect(files[0].newPath).toBe("src/app.ts");
    expect(files[0].hunks[0].header).toBe("@@ -1,3 +1,4 @@");
    expect(files[0].hunks[0].lines.map((line) => line.kind)).toEqual([
      "context",
      "remove",
      "add",
      "add",
      "context",
      "context",
    ]);
  });

  it("parses bare unified diffs without diff --git headers", () => {
    const files = parseUnifiedDiff(`--- a/old.txt
+++ b/new.txt
@@ -1 +1 @@
-old
+new`);

    expect(files).toHaveLength(1);
    expect(files[0].header).toBe("--- a/old.txt");
    expect(files[0].oldPath).toBe("old.txt");
    expect(files[0].newPath).toBe("new.txt");
    expect(files[0].hunks[0].lines).toEqual([
      { kind: "remove", text: "-old" },
      { kind: "add", text: "+new" },
    ]);
  });

  it("preserves /dev/null for created and deleted files", () => {
    const created = parseUnifiedDiff(`diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello`);
    const deleted = parseUnifiedDiff(`diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye`);

    expect(created[0].oldPath).toBe("/dev/null");
    expect(created[0].newPath).toBe("new.txt");
    expect(deleted[0].oldPath).toBe("old.txt");
    expect(deleted[0].newPath).toBe("/dev/null");
  });

  it("keeps no-newline markers as metadata lines", () => {
    const files = parseUnifiedDiff(`--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file`);

    expect(files[0].hunks[0].lines.map((line) => line.kind)).toEqual([
      "remove",
      "meta",
      "add",
      "meta",
    ]);
  });

  it("returns no files for empty or non-diff content", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("not a diff")).toEqual([]);
  });
});
