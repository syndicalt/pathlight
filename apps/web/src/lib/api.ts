"use client";

export const COLLECTOR_URL = process.env.NEXT_PUBLIC_COLLECTOR_URL || "http://localhost:4100";
export const PATHLIGHT_ACCESS_TOKEN = process.env.NEXT_PUBLIC_PATHLIGHT_ACCESS_TOKEN || "";

export function pathlightHeaders(headers: Record<string, string> = {}): Record<string, string> {
  if (!PATHLIGHT_ACCESS_TOKEN) return headers;
  return {
    ...headers,
    authorization: `Bearer ${PATHLIGHT_ACCESS_TOKEN}`,
  };
}

export async function fetchApi<T>(path: string): Promise<T> {
  const res = await fetch(`${COLLECTOR_URL}${path}`, { headers: pathlightHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function patchApi<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${COLLECTOR_URL}${path}`, {
    method: "PATCH",
    headers: pathlightHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}
