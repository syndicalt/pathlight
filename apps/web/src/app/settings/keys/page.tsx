"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { COLLECTOR_URL } from "../../../lib/api";

interface ApiKey {
  id: string;
  projectId: string;
  kind: "llm" | "git";
  provider: string;
  label: string;
  preview: string;
  createdAt: string;
  lastUsedAt: string | null;
}

async function listKeys(projectId: string): Promise<ApiKey[]> {
  const res = await fetch(`${COLLECTOR_URL}/v1/projects/${projectId}/keys`);
  if (!res.ok) throw new Error(`list failed: ${res.status}`);
  const body = (await res.json()) as { keys: ApiKey[] };
  return body.keys;
}

async function createKey(projectId: string, input: Omit<ApiKey, "id" | "projectId" | "preview" | "createdAt" | "lastUsedAt"> & { value: string }): Promise<void> {
  const res = await fetch(`${COLLECTOR_URL}/v1/projects/${projectId}/keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `create failed: ${res.status}`);
  }
}

async function rotateKey(
  projectId: string,
  keyId: string,
  input: Omit<ApiKey, "id" | "projectId" | "preview" | "createdAt" | "lastUsedAt"> & { value: string },
): Promise<void> {
  const res = await fetch(`${COLLECTOR_URL}/v1/projects/${projectId}/keys/${keyId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`rotate failed: ${res.status}`);
}

async function deleteKey(projectId: string, keyId: string): Promise<void> {
  const res = await fetch(`${COLLECTOR_URL}/v1/projects/${projectId}/keys/${keyId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`delete failed: ${res.status}`);
}

export default function KeysSettingsPage() {
  // Pathlight has no auth layer yet, so project selection is a free-text input for now.
  const [projectId, setProjectId] = useState("");
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add-key form state.
  const [kind, setKind] = useState<"llm" | "git">("llm");
  const [provider, setProvider] = useState("anthropic");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Rotate state — keyed by row ID so each row has an independent flow.
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [rotateValue, setRotateValue] = useState("");

  async function refresh(): Promise<void> {
    if (!projectId) {
      setKeys([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await listKeys(projectId);
      setKeys(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function onAdd(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!projectId || !label || !value) return;
    setSubmitting(true);
    setError(null);
    try {
      await createKey(projectId, { kind, provider, label, value });
      setLabel("");
      setValue("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function onRotate(k: ApiKey): Promise<void> {
    if (!rotateValue) return;
    setSubmitting(true);
    setError(null);
    try {
      await rotateKey(projectId, k.id, {
        kind: k.kind,
        provider: k.provider,
        label: k.label,
        value: rotateValue,
      });
      setRotatingId(null);
      setRotateValue("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(k: ApiKey): Promise<void> {
    if (!confirm(`Revoke "${k.label}"? This cannot be undone.`)) return;
    try {
      await deleteKey(projectId, k.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-zinc-500 hover:text-zinc-300">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">BYOK API keys</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Encrypted-at-rest storage for the LLM and git tokens the fix-engine uses. Keys are scoped per project; values are never returned by any endpoint after creation.
          </p>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
        <label className="block text-xs uppercase tracking-wide text-zinc-500">
          Project ID
        </label>
        <input
          type="text"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          placeholder="proj_xxx"
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
        />
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-900 rounded-lg p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {projectId && (
        <form onSubmit={onAdd} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
          <h2 className="font-medium">Add a key</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Kind</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as "llm" | "git")}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm"
              >
                <option value="llm">LLM key</option>
                <option value="git">Git token</option>
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Provider</label>
              <input
                type="text"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder={kind === "llm" ? "anthropic | openai" : "github | gitlab"}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="prod"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Value</label>
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="sk-ant-… / ghp_…"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm font-mono"
              autoComplete="off"
            />
            <p className="text-xs text-zinc-500 mt-1">
              Sealed with libsodium before hitting the database. After creation you will only see the last four characters.
            </p>
          </div>
          <button
            type="submit"
            disabled={submitting || !label || !value}
            className="bg-zinc-100 text-zinc-950 px-4 py-2 rounded text-sm font-medium hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Adding…" : "Add key"}
          </button>
        </form>
      )}

      {projectId && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950/50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="text-left px-4 py-2">Label</th>
                <th className="text-left px-4 py-2">Kind</th>
                <th className="text-left px-4 py-2">Provider</th>
                <th className="text-left px-4 py-2">Preview</th>
                <th className="text-left px-4 py-2">Last used</th>
                <th className="text-right px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-zinc-500 px-4 py-6">
                    Loading…
                  </td>
                </tr>
              ) : keys.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-zinc-500 px-4 py-6">
                    No keys yet for this project.
                  </td>
                </tr>
              ) : (
                keys.map((k) => (
                  <tr key={k.id} className="border-t border-zinc-800">
                    <td className="px-4 py-3 font-medium">{k.label}</td>
                    <td className="px-4 py-3 text-zinc-400">{k.kind}</td>
                    <td className="px-4 py-3 text-zinc-400">{k.provider}</td>
                    <td className="px-4 py-3 font-mono text-zinc-500">
                      ••••••••{k.preview}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {rotatingId === k.id ? (
                        <span className="inline-flex items-center gap-2">
                          <input
                            type="password"
                            value={rotateValue}
                            onChange={(e) => setRotateValue(e.target.value)}
                            placeholder="new value"
                            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs font-mono w-40"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            onClick={() => void onRotate(k)}
                            disabled={!rotateValue || submitting}
                            className="text-xs px-2 py-1 bg-zinc-100 text-zinc-950 rounded disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRotatingId(null);
                              setRotateValue("");
                            }}
                            className="text-xs text-zinc-400 hover:text-zinc-200"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setRotatingId(k.id);
                              setRotateValue("");
                            }}
                            className="text-xs text-zinc-300 hover:text-white"
                          >
                            Rotate
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDelete(k)}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            Revoke
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
