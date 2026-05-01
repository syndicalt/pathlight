export interface AlignableSpan {
  name: string;
}

export function alignSpans<T extends AlignableSpan>(
  left: T[],
  right: T[],
): Array<{ a: T | null; b: T | null }> {
  // Align by position in a name-keyed LCS. Spans sharing the same name at the
  // same sequential rank are paired; unpaired spans show as adds/removes.
  const leftNames = left.map((s) => s.name);
  const rightNames = right.map((s) => s.name);
  const m = leftNames.length;
  const n = rightNames.length;

  const table: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      table[i][j] = leftNames[i - 1] === rightNames[j - 1]
        ? table[i - 1][j - 1] + 1
        : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }

  const pairs: Array<{ a: T | null; b: T | null }> = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (leftNames[i - 1] === rightNames[j - 1]) {
      pairs.unshift({ a: left[i - 1], b: right[j - 1] });
      i--;
      j--;
    } else if (table[i - 1][j] >= table[i][j - 1]) {
      pairs.unshift({ a: left[i - 1], b: null });
      i--;
    } else {
      pairs.unshift({ a: null, b: right[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    pairs.unshift({ a: left[i - 1], b: null });
    i--;
  }
  while (j > 0) {
    pairs.unshift({ a: null, b: right[j - 1] });
    j--;
  }
  return pairs;
}
