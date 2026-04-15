"use client";

const COLLECTOR_URL = process.env.NEXT_PUBLIC_COLLECTOR_URL || "http://localhost:4100";

export async function fetchApi<T>(path: string): Promise<T> {
  const res = await fetch(`${COLLECTOR_URL}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}
