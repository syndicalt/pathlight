"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { COLLECTOR_URL, pathlightHeaders } from "../../lib/api";

export interface ApiKeyOption {
  id: string;
  kind: "llm" | "git";
  provider: string;
  label: string;
  preview: string;
  lastUsedAt: string | null;
}

interface KeyPickerProps {
  projectId: string;
  kind: "llm" | "git";
  /** Restrict to a single provider (e.g. "anthropic"). Omit to include all. */
  provider?: string;
  value: string;
  onChange: (keyId: string) => void;
}

export function KeyPicker({ projectId, kind, provider, value, onChange }: KeyPickerProps) {
  const [keys, setKeys] = useState<ApiKeyOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setKeys(null);
    setError(null);
    fetch(`${COLLECTOR_URL}/v1/projects/${encodeURIComponent(projectId)}/keys`, {
      headers: pathlightHeaders(),
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(res.status === 404 ? "Key store not enabled on this collector" : `fetch failed: ${res.status}`);
        }
        return (await res.json()) as { keys: ApiKeyOption[] };
      })
      .then((body) => {
        if (cancelled) return;
        setKeys(body.keys);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setKeys([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const filtered = (keys ?? []).filter((k) => {
    if (k.kind !== kind) return false;
    if (provider && k.provider !== provider) return false;
    return true;
  });

  if (keys === null) {
    return <div className="text-xs text-zinc-500 px-2 py-1.5">Loading keys…</div>;
  }

  if (error) {
    return (
      <div className="bg-red-950/40 border border-red-900 rounded px-2 py-1.5 text-xs text-red-300">
        {error}.{" "}
        <Link href="/settings/keys" className="underline hover:text-red-200">
          Manage keys
        </Link>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="bg-zinc-950 border border-zinc-800 rounded px-2 py-2 text-xs text-zinc-400">
        No {kind === "llm" ? "LLM keys" : "git tokens"}
        {provider ? ` for ${provider}` : ""} yet.{" "}
        <Link href="/settings/keys" className="text-zinc-200 underline hover:text-white">
          Add one
        </Link>
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-600"
    >
      <option value="">Select a {kind === "llm" ? "key" : "token"}…</option>
      {filtered.map((k) => (
        <option key={k.id} value={k.id}>
          {k.label} · {k.provider} · ••••{k.preview}
          {k.lastUsedAt ? ` · used ${new Date(k.lastUsedAt).toLocaleDateString()}` : " · unused"}
        </option>
      ))}
    </select>
  );
}
