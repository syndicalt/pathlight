/**
 * @pathlight/keys — BYOK encrypted key storage.
 *
 * Security invariants (parent issue #44):
 *   1. Plaintext is NEVER stored. Every write passes through `seal()`.
 *   2. Plaintext is NEVER logged, thrown, or returned from any endpoint.
 *   3. `PATHLIGHT_SEAL_KEY` is required — fail-stop on missing/malformed.
 *   4. Decryption failure is constant-time and opaque (`DecryptionError`).
 *   5. Cross-project access returns `null` (same shape as not-found).
 *
 * See `LEAK-AUDIT.md` in this package for the per-release audit checklist.
 */

export { loadSealKey, SealKeyError } from "./seal-key.js";
