import type { OpenClawPluginApi, PluginHookHandlerMap, PluginHookName } from "openclaw/plugin-sdk/plugin-entry";
import type { Trace, Span } from "@pathlight/sdk";

export function createSafeOn(api: OpenClawPluginApi) {
  let collectorDegraded = false;

  return function safeOn<K extends PluginHookName>(
    hookName: K,
    handler: PluginHookHandlerMap[K],
  ): void {
    const wrapped = (async (event: unknown, ctx: unknown) => {
      try {
        await (handler as (e: unknown, c: unknown) => unknown)(event, ctx);
      } catch (err) {
        if (!collectorDegraded) {
          collectorDegraded = true;
          api.logger.warn(
            `pathlight: hook "${hookName}" threw; tracing will continue best-effort`,
            { err: String(err) },
          );
        }
      }
    }) as PluginHookHandlerMap[K];
    api.on(hookName, wrapped);
  };
}

export function silence(target: Trace | Span): void {
  void target.id.catch(() => {});
}
