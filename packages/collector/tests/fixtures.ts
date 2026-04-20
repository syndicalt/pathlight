import { createDb, runMigrations } from "@pathlight/db";
import { createRouter } from "../src/router.js";

/**
 * Build a fresh in-memory collector instance for each test. Each call
 * returns a Hono app plus a `call(path, init?)` helper that returns the
 * parsed JSON body so tests don't have to manage fetch boilerplate.
 */
export async function buildCollector() {
  const db = createDb(":memory:");
  await runMigrations(db);
  const app = await createRouter({ db });

  async function call<T = unknown>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
    const req = new Request(`http://test${path}`, init);
    const res = await app.fetch(req);
    const text = await res.text();
    let body: T;
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = text as unknown as T;
    }
    return { status: res.status, body };
  }

  return { app, call };
}
