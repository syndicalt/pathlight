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

export function pathlightEventSourceUrl(path: string): string {
  const url = new URL(`${COLLECTOR_URL}${path}`);
  if (PATHLIGHT_ACCESS_TOKEN) url.searchParams.set("access_token", PATHLIGHT_ACCESS_TOKEN);
  return url.toString();
}

export async function fetchApi<T>(path: string): Promise<T> {
  const res = await fetch(`${COLLECTOR_URL}${path}`, { headers: pathlightHeaders() });
  if (!res.ok) throw new Error(await apiErrorMessage(res));
  return res.json() as Promise<T>;
}

export async function patchApi<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${COLLECTOR_URL}${path}`, {
    method: "PATCH",
    headers: pathlightHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res));
  return res.json() as Promise<T>;
}

export async function apiErrorMessage(res: Response): Promise<string> {
  const fallback = `Pathlight collector returned ${res.status}`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return `${fallback}: ${body.error}`;
    if (body.error && typeof body.error === "object" && "message" in body.error) {
      const message = (body.error as { message?: unknown }).message;
      if (typeof message === "string") return `${fallback}: ${message}`;
    }
    return fallback;
  } catch {
    return fallback;
  }
}
