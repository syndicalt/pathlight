import { randomUUID } from "node:crypto";

const runtime = {
  id: randomUUID(),
  startedAt: new Date().toISOString(),
};

export function getCollectorRuntime() {
  return runtime;
}
