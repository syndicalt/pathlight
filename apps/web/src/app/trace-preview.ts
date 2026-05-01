export function parseTraceTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((tag): tag is string => typeof tag === "string" && tag.length > 0);
  } catch {
    return [];
  }
}

export function traceInputPreview(input: string | null, maxLength = 100): string {
  if (!input) return "";
  try {
    const parsed = JSON.parse(input) as unknown;
    if (typeof parsed === "string") return truncate(parsed, maxLength);
    if (parsed && typeof parsed === "object") {
      const values = Object.values(parsed)
        .map((value) => previewValue(value))
        .filter(Boolean);
      return truncate(values.join(" "), maxLength);
    }
  } catch {
    return truncate(input, maxLength);
  }
  return truncate(String(input), maxLength);
}

function previewValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
