import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  listBreakpoints,
  registerBreakpoint,
  resumeBreakpoint,
  cancelBreakpoint,
  breakpointEvents,
  type Breakpoint,
} from "../breakpoints.js";
import { getCollectorRuntime } from "../runtime.js";

export function createBreakpointRoutes() {
  const app = new Hono();

  // Register and block on a breakpoint. Held open until the UI calls /resume,
  // which responds with the (possibly-modified) state the SDK should continue
  // with. Timeout of 15m prevents wedged SDK processes from holding a request
  // open forever.
  app.post("/", async (c) => {
    const body = await c.req.json<{
      label?: string;
      traceId?: string;
      spanId?: string;
      state?: unknown;
      timeoutMs?: number;
    }>();

    const { id, wait } = registerBreakpoint({
      label: body.label || "(unnamed)",
      traceId: body.traceId,
      spanId: body.spanId,
      state: body.state ?? null,
    });

    const timeoutMs = Math.min(Math.max(body.timeoutMs ?? 15 * 60_000, 1_000), 60 * 60_000);
    const timeoutHandle = setTimeout(() => {
      cancelBreakpoint(id, "timeout");
    }, timeoutMs);

    try {
      const state = await wait;
      clearTimeout(timeoutHandle);
      return c.json({ id, resumed: true, state });
    } catch (err) {
      clearTimeout(timeoutHandle);
      return c.json(
        { id, resumed: false, error: err instanceof Error ? err.message : "unknown" },
        408,
      );
    }
  });

  app.get("/", (c) => {
    return c.json({ breakpoints: listBreakpoints(), runtime: getCollectorRuntime() });
  });

  app.post("/:id/resume", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ state?: unknown }>().catch(() => ({ state: undefined }));
    const ok = resumeBreakpoint(id, body.state);
    if (!ok) return c.json({ error: "breakpoint not found" }, 404);
    return c.json({ resumed: true });
  });

  app.post("/:id/cancel", (c) => {
    const id = c.req.param("id");
    const ok = cancelBreakpoint(id, "cancelled by user");
    if (!ok) return c.json({ error: "breakpoint not found" }, 404);
    return c.json({ cancelled: true });
  });

  app.get("/stream", (c) => {
    return streamSSE(c, async (stream) => {
      // Send initial snapshot so the dashboard doesn't have to poll once on load.
      await stream.writeSSE({
        event: "snapshot",
        data: JSON.stringify({ breakpoints: listBreakpoints(), runtime: getCollectorRuntime() }),
      });

      const onAdded = (bp: Breakpoint) => {
        stream.writeSSE({ event: "added", data: JSON.stringify(bp) }).catch(() => {});
      };
      const onResolved = (payload: { id: string }) => {
        stream.writeSSE({ event: "resolved", data: JSON.stringify(payload) }).catch(() => {});
      };
      const onCancelled = (payload: { id: string; reason: string }) => {
        stream.writeSSE({ event: "cancelled", data: JSON.stringify(payload) }).catch(() => {});
      };
      breakpointEvents.on("added", onAdded);
      breakpointEvents.on("resolved", onResolved);
      breakpointEvents.on("cancelled", onCancelled);

      const heartbeat = setInterval(() => {
        stream.writeSSE({ event: "ping", data: JSON.stringify({ runtime: getCollectorRuntime() }) }).catch(() => {});
      }, 25_000);

      stream.onAbort(() => {
        clearInterval(heartbeat);
        breakpointEvents.off("added", onAdded);
        breakpointEvents.off("resolved", onResolved);
        breakpointEvents.off("cancelled", onCancelled);
      });

      while (!stream.aborted) {
        await stream.sleep(60_000);
      }
      clearInterval(heartbeat);
      breakpointEvents.off("added", onAdded);
      breakpointEvents.off("resolved", onResolved);
      breakpointEvents.off("cancelled", onCancelled);
    });
  });

  return app;
}
