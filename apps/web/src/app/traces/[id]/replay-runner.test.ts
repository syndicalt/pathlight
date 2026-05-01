import { describe, expect, it, vi } from "vitest";
import {
  persistReplaySettings,
  replayErrorResult,
  replayRequestBody,
  replayResultFromResponse,
} from "./replay-runner";

describe("replayRequestBody", () => {
  it("omits empty optional fields", () => {
    expect(replayRequestBody({
      provider: "openai",
      model: "gpt-test",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      apiKey: "",
      baseUrl: "",
    })).toEqual({
      provider: "openai",
      model: "gpt-test",
      system: undefined,
      messages: [{ role: "user", content: "hi" }],
      apiKey: undefined,
      baseUrl: undefined,
    });
  });
});

describe("replayResultFromResponse", () => {
  it("formats successful replay output and token counts", () => {
    expect(replayResultFromResponse(true, {
      output: "hello",
      durationMs: 42,
      inputTokens: 3,
      outputTokens: 5,
    })).toEqual({
      output: "hello",
      durationMs: 42,
      tokens: "3/5 tok",
    });
  });

  it("formats sanitized collector errors", () => {
    expect(replayResultFromResponse(false, { error: { message: "bad key", status: 401 } })).toEqual({
      output: "",
      durationMs: 0,
      error: JSON.stringify({ message: "bad key", status: 401 }, null, 2),
    });
  });
});

describe("replayErrorResult", () => {
  it("turns thrown errors into replay result errors", () => {
    expect(replayErrorResult(new Error("network down"))).toEqual({
      output: "",
      durationMs: 0,
      error: "network down",
    });
  });
});

describe("persistReplaySettings", () => {
  it("keeps API keys session-scoped and base URLs in local storage", () => {
    const sessionStorage = mockStorage();
    const localStorage = mockStorage();

    persistReplaySettings({ provider: "openai", apiKey: "sk-test", baseUrl: "https://example.test" }, {
      sessionStorage,
      localStorage,
    });

    expect(sessionStorage.setItem).toHaveBeenCalledWith("pathlight:replay-key:openai", "sk-test");
    expect(localStorage.setItem).toHaveBeenCalledWith("pathlight:replay-base:openai", "https://example.test");
  });

  it("removes empty settings", () => {
    const sessionStorage = mockStorage();
    const localStorage = mockStorage();

    persistReplaySettings({ provider: "anthropic", apiKey: "", baseUrl: "" }, { sessionStorage, localStorage });

    expect(sessionStorage.removeItem).toHaveBeenCalledWith("pathlight:replay-key:anthropic");
    expect(localStorage.removeItem).toHaveBeenCalledWith("pathlight:replay-base:anthropic");
  });
});

function mockStorage(): Storage {
  return {
    length: 0,
    clear: vi.fn(),
    getItem: vi.fn(),
    key: vi.fn(),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  };
}
