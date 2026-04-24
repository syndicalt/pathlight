/**
 * Authenticated encryption for BYOK secrets using libsodium's
 * `crypto_secretbox_easy` (XSalsa20 + Poly1305).
 *
 * Wire format for sealed values:
 *   base64( nonce[24] || ciphertext )
 * Nonce is freshly generated for every call (no reuse across plaintexts).
 *
 * Security guarantees enforced here:
 *   - Fresh random nonce per seal() call.
 *   - Constant-time authentication check via libsodium.
 *   - `unseal()` throws a GENERIC `DecryptionError` with no detail about
 *     why the operation failed (no distinguishing "bad tag" vs "malformed
 *     input" vs "wrong key" — parent invariant #5 from issue #44).
 *   - Inputs/outputs are never logged by this module.
 */

// libsodium-wrappers' ESM build has a broken relative import to a
// sibling `libsodium.mjs` that npm doesn't colocate at install time.
// Load via createRequire to use the reliable CJS entry.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sodium = require("libsodium-wrappers") as typeof import("libsodium-wrappers");

let ready: Promise<void> | null = null;

async function ensureReady(): Promise<void> {
  if (!ready) {
    ready = sodium.ready;
  }
  await ready;
}

/**
 * Raised on any unseal failure. Deliberately generic — the message does
 * not reveal whether the ciphertext was truncated, the MAC failed, or
 * the key was wrong. Consumers must not chain `cause` into HTTP
 * responses or logs.
 */
export class DecryptionError extends Error {
  constructor() {
    super("decryption failed");
    this.name = "DecryptionError";
  }
}

/**
 * Encrypt `plaintext` with the master `key` and return a base64-packed
 * ciphertext. A fresh nonce is generated for every call.
 *
 * IMPORTANT: callers must never log either `plaintext` or the returned
 * string without re-reading the leak-audit checklist. The ciphertext
 * is opaque but its mere presence in a log signals an insecure code
 * path (error branches that stringify a record, etc.).
 */
export async function seal(plaintext: string, key: Uint8Array): Promise<string> {
  await ensureReady();
  if (key.length !== sodium.crypto_secretbox_KEYBYTES) {
    // Generic — don't reveal expected vs got length anywhere that could
    // be logged by the caller.
    throw new Error("invalid seal key");
  }
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const message = sodium.from_string(plaintext);
  const ciphertext = sodium.crypto_secretbox_easy(message, nonce, key);
  const packed = new Uint8Array(nonce.length + ciphertext.length);
  packed.set(nonce, 0);
  packed.set(ciphertext, nonce.length);
  return sodium.to_base64(packed, sodium.base64_variants.ORIGINAL);
}

/**
 * Decrypt a base64-packed nonce+ciphertext produced by `seal()`. Throws
 * `DecryptionError` on ANY failure — malformed input, truncated bytes,
 * wrong key, bad MAC. Callers must not stringify the thrown error into
 * user-facing responses.
 */
export async function unseal(sealed: string, key: Uint8Array): Promise<string> {
  await ensureReady();
  try {
    if (key.length !== sodium.crypto_secretbox_KEYBYTES) {
      throw new DecryptionError();
    }
    const packed = sodium.from_base64(sealed, sodium.base64_variants.ORIGINAL);
    if (packed.length < sodium.crypto_secretbox_NONCEBYTES + sodium.crypto_secretbox_MACBYTES) {
      throw new DecryptionError();
    }
    const nonce = packed.subarray(0, sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = packed.subarray(sodium.crypto_secretbox_NONCEBYTES);
    const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
    return sodium.to_string(plaintext);
  } catch (err) {
    // Always collapse to a single, detail-free error. Never re-throw the
    // underlying libsodium error (it may contain diagnostic info that
    // leaks through logging).
    if (err instanceof DecryptionError) throw err;
    throw new DecryptionError();
  }
}

/**
 * Extract the last-4 characters of a plaintext for masked UI display.
 * Returns the full plaintext if it's ≤ 4 chars (edge case; keys should
 * never be that short in practice). This is the ONLY piece of the
 * plaintext that's ever persisted unencrypted — it's a UX affordance,
 * not a secret.
 */
export function previewLast4(plaintext: string): string {
  if (plaintext.length <= 4) return plaintext;
  return plaintext.slice(-4);
}
