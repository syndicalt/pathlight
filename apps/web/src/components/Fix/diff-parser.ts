export interface ParsedFile {
  header: string;
  oldPath: string;
  newPath: string;
  hunks: ParsedHunk[];
}

export interface ParsedHunk {
  header: string;
  lines: ParsedLine[];
}

export interface ParsedLine {
  kind: "add" | "remove" | "context" | "meta";
  text: string;
}

export function parseUnifiedDiff(diff: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  const lines = diff.split("\n");
  let i = 0;

  while (i < lines.length) {
    // Skip anything before the first diff header.
    if (!lines[i].startsWith("diff --git") && !lines[i].startsWith("--- ")) {
      i++;
      continue;
    }

    const header = lines[i];
    let oldPath = "";
    let newPath = "";

    // Accept both "diff --git a/x b/y\n--- a/x\n+++ b/y" and bare "--- a/x\n+++ b/y".
    if (lines[i].startsWith("diff --git")) i++;
    // Skip index/mode lines.
    while (i < lines.length && !lines[i].startsWith("--- ") && !lines[i].startsWith("@@")) {
      i++;
    }
    if (i < lines.length && lines[i].startsWith("--- ")) {
      oldPath = lines[i].slice(4).replace(/^a\//, "");
      i++;
    }
    if (i < lines.length && lines[i].startsWith("+++ ")) {
      newPath = lines[i].slice(4).replace(/^b\//, "");
      i++;
    }

    const hunks: ParsedHunk[] = [];
    while (i < lines.length && lines[i].startsWith("@@")) {
      const hunkHeader = lines[i];
      i++;
      const hunkLines: ParsedLine[] = [];
      while (
        i < lines.length &&
        !lines[i].startsWith("@@") &&
        !lines[i].startsWith("diff --git") &&
        !lines[i].startsWith("--- ")
      ) {
        const text = lines[i];
        if (text.startsWith("+")) hunkLines.push({ kind: "add", text });
        else if (text.startsWith("-")) hunkLines.push({ kind: "remove", text });
        else if (text.startsWith("\\")) hunkLines.push({ kind: "meta", text });
        else hunkLines.push({ kind: "context", text });
        i++;
      }
      hunks.push({ header: hunkHeader, lines: hunkLines });
    }

    if (oldPath || newPath || hunks.length > 0) {
      files.push({ header, oldPath, newPath: newPath || oldPath, hunks });
    }
  }

  return files;
}
