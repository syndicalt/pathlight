import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { seal, unseal, previewLast4, DecryptionError } from "../src/seal.js";

function freshKey(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

describe("seal/unseal", () => {
  it("roundtrips a simple plaintext", async () => {
    const key = freshKey();
    const sealed = await seal("sk-test-abc-123", key);
    const plain = await unseal(sealed, key);
    expect(plain).toBe("sk-test-abc-123");
  });

  it("survives 1000 roundtrips across varied inputs", async () => {
    const key = freshKey();
    const inputs: string[] = [];
    for (let i = 0; i < 1000; i++) {
      // Mix short, long, unicode, newlines.
      const n = (i % 7) + 1;
      inputs.push(`key-${i}-${"x".repeat(n)}-ü€🔑\n${i}`);
    }
    for (const p of inputs) {
      const sealed = await seal(p, key);
      const unsealed = await unseal(sealed, key);
      expect(unsealed).toBe(p);
    }
  });

  it("produces a different ciphertext each call (fresh nonce)", async () => {
    const key = freshKey();
    const a = await seal("same-secret", key);
    const b = await seal("same-secret", key);
    expect(a).not.toBe(b);
  });

  it("throws DecryptionError on a bad ciphertext (wrong key)", async () => {
    const k1 = freshKey();
    const k2 = freshKey();
    const sealed = await seal("hello", k1);
    await expect(unseal(sealed, k2)).rejects.toBeInstanceOf(DecryptionError);
  });

  it("throws DecryptionError on a truncated ciphertext", async () => {
    const key = freshKey();
    const sealed = await seal("hello", key);
    const mangled = sealed.slice(0, 10);
    await expect(unseal(mangled, key)).rejects.toBeInstanceOf(DecryptionError);
  });

  it("throws DecryptionError on non-base64 garbage", async () => {
    const key = freshKey();
    await expect(unseal("!!!not-base64!!!", key)).rejects.toBeInstanceOf(DecryptionError);
  });

  it("DecryptionError has a generic, detail-free message", async () => {
    const key = freshKey();
    try {
      await unseal("garbage", key);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DecryptionError);
      // Message must not vary by failure mode (parent invariant #5).
      expect((err as DecryptionError).message).toBe("decryption failed");
    }
  });

  it("throws DecryptionError on tampered ciphertext (flipped byte)", async () => {
    const key = freshKey();
    const sealed = await seal("sensitive", key);
    // Flip one base64 char near the middle to simulate bit-flip.
    const idx = Math.floor(sealed.length / 2);
    const flipped = sealed.slice(0, idx) + (sealed[idx] === "A" ? "B" : "A") + sealed.slice(idx + 1);
    await expect(unseal(flipped, key)).rejects.toBeInstanceOf(DecryptionError);
  });
});

describe("previewLast4", () => {
  it("returns the last 4 characters of a typical key", () => {
    expect(previewLast4("sk-proj-12345abcd")).toBe("abcd");
  });

  it("returns the whole string if <= 4 chars", () => {
    expect(previewLast4("abc")).toBe("abc");
    expect(previewLast4("abcd")).toBe("abcd");
  });
});
