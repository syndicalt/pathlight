/**
 * Central secret-scrubbing helpers. Enforces parent invariant #1:
 *   "Never log, never emit API keys or git tokens."
 *
 * Every error message, trace output, and console write that touches user
 * input MUST go through one of these helpers. The rule we enforce is simple:
 * before any string is surfaced outside the engine, substitute any known
 * secret in that string with `[REDACTED]`.
 *
 * The helpers accept a loose list of secrets because a single `fix()`
 * invocation may carry multiple (LLM key, git token).
 */

/** A value that might contain secrets to scrub. */
export type RedactableSecret = string | undefined | null;

/** Substitute every known secret in `input` with `[REDACTED]`. */
export function redact(input: string, ...secrets: RedactableSecret[]): string {
  let out = input;
  for (const secret of secrets) {
    if (!secret || typeof secret !== "string" || secret.length < 4) continue;
    // Use split/join to avoid regex-escape issues with tokens that contain
    // special regex characters.
    out = out.split(secret).join("[REDACTED]");
  }
  // Also scrub the basic-auth URL shape that buildAuthenticatedUrl produces.
  out = out.replace(/x-access-token:[^@\s"']+@/g, "x-access-token:[REDACTED]@");
  return out;
}

/**
 * Build a redactor bound to a specific set of secrets. Useful in hot paths
 * that surface multiple messages for the same invocation.
 */
export function makeRedactor(...secrets: RedactableSecret[]): (input: string) => string {
  const known = secrets.filter((s): s is string => typeof s === "string" && s.length >= 4);
  return (input: string) => redact(input, ...known);
}

/**
 * Defensive test: does `haystack` contain any of the `secrets` as a literal
 * substring? Used by our token-scrubbing regression tests.
 */
export function containsAnySecret(haystack: string, ...secrets: RedactableSecret[]): boolean {
  for (const secret of secrets) {
    if (!secret || typeof secret !== "string" || secret.length < 4) continue;
    if (haystack.includes(secret)) return true;
  }
  return false;
}
