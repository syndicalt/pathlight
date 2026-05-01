/**
 * Minimal POST-capable SSE client. EventSource can't POST, so we do it
 * manually: fetch with a ReadableStream body, parse the text stream
 * into SSE events (`event:` + `data:` blank-line-separated).
 */

export interface SSEEvent {
  event: string;
  data: string;
}

export interface OpenSSEOptions {
  url: string;
  body: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
  onEvent: (event: SSEEvent) => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
}

export async function openSSE(options: OpenSSEOptions): Promise<void> {
  let response: Response;
  try {
    response = await fetch(options.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", ...options.headers },
      body: JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (err) {
    options.onError?.(err);
    options.onClose?.();
    return;
  }

  if (!response.ok || !response.body) {
    options.onError?.(new Error(`SSE open failed: ${response.status}`));
    options.onClose?.();
    return;
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseEvent(raw);
        if (parsed) options.onEvent(parsed);
        boundary = buffer.indexOf("\n\n");
      }
    }
  } catch (err) {
    if (!(err instanceof DOMException && err.name === "AbortError")) {
      options.onError?.(err);
    }
  } finally {
    options.onClose?.();
  }
}

function parseEvent(raw: string): SSEEvent | null {
  let event = "message";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trim();
  }
  if (!data) return null;
  return { event, data };
}
