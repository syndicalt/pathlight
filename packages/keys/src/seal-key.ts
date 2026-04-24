/**
 * Seal-key loader. Reads `PATHLIGHT_SEAL_KEY` from the environment and
 * validates it as a 32-byte base64 value. FAIL-STOP: if the key is
 * missing or malformed, throw and let the process die. NEVER generate a
 * default and NEVER fall back to an insecure key — this is parent
 * invariant #4 from issue #44.
 *
 * Consumers should call `loadSealKey()` once at collector/web boot and
 * inject the resulting bytes into `seal()` / `unseal()`. The returned
 * Uint8Array is the raw key; do NOT log it.
 */

const SEAL_KEY_BYTES = 32; // crypto_secretbox_KEYBYTES

export class SealKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealKeyError";
  }
}

function decodeBase64(input: string): Uint8Array {
  // Strict base64 decode; throws on invalid input rather than silently
  // returning truncated bytes (which would produce an incorrect key).
  try {
    const buf = Buffer.from(input, "base64");
    // Round-trip check — if re-encoding doesn't match, the input had
    // invalid characters that Buffer silently skipped.
    if (buf.toString("base64").replace(/=+$/, "") !== input.replace(/=+$/, "")) {
      throw new Error("base64 round-trip mismatch");
    }
    return new Uint8Array(buf);
  } catch {
    throw new SealKeyError(
      "PATHLIGHT_SEAL_KEY is not valid base64. Generate a new one with: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
}

/**
 * Load and validate the master seal key. Throws `SealKeyError` on any
 * failure — callers should let this propagate and crash the process.
 */
export function loadSealKey(env: NodeJS.ProcessEnv = process.env): Uint8Array {
  const raw = env.PATHLIGHT_SEAL_KEY;
  if (!raw || raw.trim() === "") {
    throw new SealKeyError(
      "PATHLIGHT_SEAL_KEY is required but not set. This is a 32-byte base64 " +
        "master key used to encrypt BYOK secrets at rest. Generate one with: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\" " +
        "and set it in your environment before starting the collector.",
    );
  }

  const bytes = decodeBase64(raw.trim());
  if (bytes.length !== SEAL_KEY_BYTES) {
    throw new SealKeyError(
      `PATHLIGHT_SEAL_KEY must decode to exactly ${SEAL_KEY_BYTES} bytes, got ${bytes.length}.`,
    );
  }
  return bytes;
}
