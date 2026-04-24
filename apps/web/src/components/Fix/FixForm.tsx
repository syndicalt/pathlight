"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { KeyPicker } from "./KeyPicker";

export type SourceMode = "path" | "git";
export type FixMode = "span" | "trace" | "bisect";
export type LlmProvider = "anthropic" | "openai";

export interface FixFormValue {
  source:
    | { kind: "path"; dir: string }
    | { kind: "git"; repoUrl: string; tokenId: string; ref: string };
  llm: {
    provider: LlmProvider;
    keyId: string;
    model?: string;
  };
  mode:
    | { kind: "span" }
    | { kind: "trace" }
    | { kind: "bisect"; from: string; to: string };
}

interface FixFormProps {
  projectId: string | null;
  submitting: boolean;
  onSubmit: (value: FixFormValue) => void;
}

export function FixForm({ projectId, submitting, onSubmit }: FixFormProps) {
  const [sourceMode, setSourceMode] = useState<SourceMode>("path");
  const [sourceDir, setSourceDir] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [gitTokenId, setGitTokenId] = useState("");
  const [ref, setRef] = useState("");

  const [provider, setProvider] = useState<LlmProvider>("anthropic");
  const [llmKeyId, setLlmKeyId] = useState("");
  const [model, setModel] = useState("");

  const [mode, setMode] = useState<FixMode>("span");
  const [fromSha, setFromSha] = useState("");
  const [toSha, setToSha] = useState("");

  const sourceValid = useMemo(() => {
    if (sourceMode === "path") return sourceDir.trim().length > 0;
    return repoUrl.trim().length > 0 && gitTokenId.trim().length > 0;
  }, [sourceMode, sourceDir, repoUrl, gitTokenId]);

  const modeValid = useMemo(() => {
    if (mode === "bisect") {
      if (sourceMode !== "git") return false;
      return fromSha.trim().length > 0 && toSha.trim().length > 0;
    }
    return true;
  }, [mode, sourceMode, fromSha, toSha]);

  const llmValid = llmKeyId.trim().length > 0;
  const projectValid = projectId !== null && projectId.length > 0;
  const canSubmit = sourceValid && modeValid && llmValid && projectValid && !submitting;

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!canSubmit) return;

    const value: FixFormValue = {
      source:
        sourceMode === "path"
          ? { kind: "path", dir: sourceDir.trim() }
          : {
              kind: "git",
              repoUrl: repoUrl.trim(),
              tokenId: gitTokenId.trim(),
              ref: ref.trim(),
            },
      llm: {
        provider,
        keyId: llmKeyId.trim(),
        model: model.trim() || undefined,
      },
      mode:
        mode === "bisect"
          ? { kind: "bisect", from: fromSha.trim(), to: toSha.trim() }
          : { kind: mode },
    };
    onSubmit(value);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {!projectValid && (
        <div className="bg-amber-900/20 border border-amber-800/50 rounded-lg p-3 text-xs text-amber-300">
          This trace has no projectId. BYOK keys are scoped per project, so the fix engine can&apos;t resolve a key here yet.
        </div>
      )}

      <Section label="Source">
        <RadioGroup
          name="source-mode"
          value={sourceMode}
          onChange={(v) => setSourceMode(v as SourceMode)}
          options={[
            { value: "path", label: "Local path" },
            { value: "git", label: "Git (clone + read-only)" },
          ]}
        />
        {sourceMode === "path" ? (
          <Field label="Source dir">
            <input
              type="text"
              value={sourceDir}
              onChange={(e) => setSourceDir(e.target.value)}
              placeholder="/abs/path/to/repo"
              className={inputClass}
              required
            />
          </Field>
        ) : (
          <div className="space-y-2">
            <Field label="Repo URL">
              <input
                type="url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo.git"
                className={inputClass}
                required
              />
            </Field>
            <Field label="Git token">
              {projectId ? (
                <KeyPicker
                  projectId={projectId}
                  kind="git"
                  value={gitTokenId}
                  onChange={setGitTokenId}
                />
              ) : (
                <input
                  type="text"
                  value={gitTokenId}
                  onChange={(e) => setGitTokenId(e.target.value)}
                  placeholder="key_xxx"
                  className={inputClass}
                  required
                />
              )}
            </Field>
            <Field label="Ref (optional, defaults to HEAD)">
              <input
                type="text"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="main"
                className={inputClass}
              />
            </Field>
          </div>
        )}
      </Section>

      <Section label="LLM">
        <RadioGroup
          name="provider"
          value={provider}
          onChange={(v) => setProvider(v as LlmProvider)}
          options={[
            { value: "anthropic", label: "Anthropic" },
            { value: "openai", label: "OpenAI" },
          ]}
        />
        <Field label="API key">
          {projectId ? (
            <KeyPicker
              projectId={projectId}
              kind="llm"
              provider={provider}
              value={llmKeyId}
              onChange={setLlmKeyId}
            />
          ) : (
            <input
              type="text"
              value={llmKeyId}
              onChange={(e) => setLlmKeyId(e.target.value)}
              placeholder="key_xxx"
              className={inputClass}
              required
            />
          )}
        </Field>
        <Field label="Model (optional)">
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={provider === "anthropic" ? "claude-opus-4-7" : "gpt-5.4"}
            className={inputClass}
          />
        </Field>
      </Section>

      <Section label="Mode">
        <RadioGroup
          name="mode"
          value={mode}
          onChange={(v) => setMode(v as FixMode)}
          options={[
            { value: "span", label: "This span" },
            { value: "trace", label: "Whole trace" },
            { value: "bisect", label: "Bisect", disabled: sourceMode !== "git" },
          ]}
        />
        {mode === "bisect" && sourceMode !== "git" && (
          <p className="text-xs text-amber-300">
            Bisect requires a git source — switch Source to &quot;Git&quot; above.
          </p>
        )}
        {mode === "bisect" && sourceMode === "git" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="From (known-good SHA)">
              <input
                type="text"
                value={fromSha}
                onChange={(e) => setFromSha(e.target.value)}
                placeholder="abc123"
                className={`${inputClass} font-mono`}
                required
              />
            </Field>
            <Field label="To (known-bad SHA)">
              <input
                type="text"
                value={toSha}
                onChange={(e) => setToSha(e.target.value)}
                placeholder="def456"
                className={`${inputClass} font-mono`}
                required
              />
            </Field>
          </div>
        )}
      </Section>

      <div className="pt-2 flex justify-end">
        <button
          type="submit"
          disabled={!canSubmit}
          className="px-4 py-2 rounded text-sm font-medium bg-orange-500/20 text-orange-200 border border-orange-500/40 hover:bg-orange-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? "Streaming…" : "Propose fix"}
        </button>
      </div>
    </form>
  );
}

const inputClass =
  "w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-600";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-zinc-600 uppercase tracking-widest">{label}</p>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-zinc-400 space-y-1">
      <span>{label}</span>
      {children}
    </label>
  );
}

interface RadioGroupProps<T extends string> {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
}
function RadioGroup<T extends string>({ name, value, onChange, options }: RadioGroupProps<T>) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <label
          key={opt.value}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border cursor-pointer ${
            value === opt.value
              ? "bg-zinc-800 border-zinc-600 text-zinc-100"
              : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700"
          } ${opt.disabled ? "opacity-40 cursor-not-allowed" : ""}`}
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            disabled={opt.disabled}
            onChange={() => !opt.disabled && onChange(opt.value)}
            className="sr-only"
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}
