"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function NewProgramForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [apiDocsUrl, setApiDocsUrl] = useState("");
  const [docsText, setDocsText] = useState("");
  const [examples, setExamples] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const response = await fetch("/api/change-requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              kind: "PROGRAM",
              title: title || undefined,
              prompt,
              apiDocsUrl: apiDocsUrl || undefined,
              docsText: docsText || undefined,
              examples: examples || undefined,
            }),
          });
          const json = (await response.json()) as {
            id?: string;
            error?: string;
          };
          if (!response.ok || !json.id) {
            setError(
              typeof json.error === "string"
                ? json.error
                : "Could not start program",
            );
            return;
          }
          router.push(`/change-requests/${json.id}`);
        });
      }}
    >
      <input
        className="field"
        placeholder="Program name (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="field min-h-28"
        placeholder="Describe the automation workflow you want to build…"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        required
      />
      <input
        className="field"
        type="url"
        placeholder="URL to API docs (optional)"
        value={apiDocsUrl}
        onChange={(e) => setApiDocsUrl(e.target.value)}
      />
      <textarea
        className="field min-h-24"
        placeholder="Paste documentation excerpts (optional)"
        value={docsText}
        onChange={(e) => setDocsText(e.target.value)}
      />
      <textarea
        className="field min-h-24"
        placeholder="Paste example requests / responses (optional)"
        value={examples}
        onChange={(e) => setExamples(e.target.value)}
      />
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      <button className="btn btn-primary" disabled={pending || !prompt.trim()}>
        {pending ? "Starting…" : "Start new program"}
      </button>
    </form>
  );
}
