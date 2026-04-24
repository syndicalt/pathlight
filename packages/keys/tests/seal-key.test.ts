import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { loadSealKey, SealKeyError } from "../src/seal-key.js";

function validKeyEnv(): NodeJS.ProcessEnv {
  return { PATHLIGHT_SEAL_KEY: Buffer.from(randomBytes(32)).toString("base64") } as NodeJS.ProcessEnv;
}

describe("loadSealKey (fail-stop)", () => {
  it("loads a valid 32-byte base64 key", () => {
    const bytes = loadSealKey(validKeyEnv());
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
  });

  it("throws SealKeyError when unset", () => {
    expect(() => loadSealKey({} as NodeJS.ProcessEnv)).toThrow(SealKeyError);
  });

  it("throws SealKeyError on empty/whitespace", () => {
    expect(() => loadSealKey({ PATHLIGHT_SEAL_KEY: "" } as NodeJS.ProcessEnv)).toThrow(SealKeyError);
    expect(() => loadSealKey({ PATHLIGHT_SEAL_KEY: "   " } as NodeJS.ProcessEnv)).toThrow(SealKeyError);
  });

  it("throws SealKeyError when the decoded length is wrong", () => {
    const tooShort = Buffer.from(randomBytes(16)).toString("base64");
    expect(() => loadSealKey({ PATHLIGHT_SEAL_KEY: tooShort } as NodeJS.ProcessEnv)).toThrow(SealKeyError);
    const tooLong = Buffer.from(randomBytes(64)).toString("base64");
    expect(() => loadSealKey({ PATHLIGHT_SEAL_KEY: tooLong } as NodeJS.ProcessEnv)).toThrow(SealKeyError);
  });

  it("throws SealKeyError on non-base64 input", () => {
    expect(() => loadSealKey({ PATHLIGHT_SEAL_KEY: "!!not-base64!!" } as NodeJS.ProcessEnv)).toThrow(SealKeyError);
  });

  it("never discloses the key bytes in the error message", () => {
    const key = "some-long-hex-secret-string-that-should-never-appear-in-a-thrown-error";
    try {
      loadSealKey({ PATHLIGHT_SEAL_KEY: key } as NodeJS.ProcessEnv);
    } catch (err) {
      expect((err as Error).message).not.toContain(key);
    }
  });
});
