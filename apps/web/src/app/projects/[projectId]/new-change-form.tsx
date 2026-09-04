"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function NewChangeForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
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
            body: JSON.stringify({ projectId, kind: "CHANGE", prompt }),
          });
          const json = (await response.json()) as {
            id?: string;
            error?: string;
          };
          if (!response.ok || !json.id) {
            setError(json.error ?? "Could not create change request");
            return;
          }
          router.push(`/change-requests/${json.id}`);
        });
      }}
    >
      <textarea
        className="field min-h-28"
        placeholder="Example: Add a way to retry invoices that failed because the customer's account was temporarily unavailable."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        required
      />
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      <button className="btn btn-ghost" disabled={pending || !prompt.trim()}>
        {pending ? "Starting…" : "Request a small change"}
      </button>
    </form>
  );
}
