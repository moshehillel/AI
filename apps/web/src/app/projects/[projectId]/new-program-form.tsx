"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function NewProgramForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [spark, setSpark] = useState("");
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
              prompt: spark || undefined,
            }),
          });
          const json = (await response.json()) as {
            id?: string;
            error?: string | { formErrors?: string[] };
          };
          if (!response.ok || !json.id) {
            const err = json.error;
            setError(
              typeof err === "string"
                ? err
                : "Add a program name or a short note to start",
            );
            return;
          }
          router.push(`/change-requests/${json.id}`);
        });
      }}
    >
      <p className="text-sm muted">
        Koda will ask clarifying questions one at a time — not a long form.
      </p>
      <input
        className="field"
        placeholder="Program name"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="field min-h-24"
        placeholder="Optional: a sentence about what you want to automate (or leave blank and let Koda ask)"
        value={spark}
        onChange={(e) => setSpark(e.target.value)}
      />
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      <button
        className="btn btn-primary"
        disabled={pending || (!title.trim() && !spark.trim())}
      >
        {pending ? "Starting…" : "Start planning with Koda"}
      </button>
    </form>
  );
}
