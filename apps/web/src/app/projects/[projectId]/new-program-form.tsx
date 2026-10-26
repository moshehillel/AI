"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function NewProgramForm({
  projectId,
  variant = "default",
  buttonLabel,
}: {
  projectId: string;
  variant?: "default" | "hero";
  buttonLabel?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [spark, setSpark] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hero = variant === "hero";

  return (
    <form
      className={hero ? "onboard-form" : "space-y-3"}
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
            error?:
              | string
              | { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
          };
          if (!response.ok || !json.id) {
            const err = json.error;
            let message: string | null = null;
            if (typeof err === "string") {
              message = err;
            } else if (err?.formErrors?.[0]) {
              message = err.formErrors[0];
            } else if (err?.fieldErrors) {
              message =
                Object.values(err.fieldErrors).flat().find(Boolean) ?? null;
            }
            setError(
              message ??
                "Could not start chat. Check access or add a short note.",
            );
            return;
          }
          router.push(`/change-requests/${json.id}`);
        });
      }}
    >
      {!hero ? (
        <p className="text-sm muted">
          Describe the change. Say push when it should be its own commit.
        </p>
      ) : null}
      <input
        className={hero ? "onboard-field" : "field"}
        placeholder="What are we improving?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Improvement name"
      />
      <textarea
        className={hero ? "onboard-field onboard-field-area" : "field min-h-24"}
        placeholder={
          hero
            ? "What should we automate?"
            : "Optional: what should change in the existing code"
        }
        value={spark}
        onChange={(e) => setSpark(e.target.value)}
        aria-label="What to improve"
        rows={hero ? 2 : 4}
      />
      {error ? (
        <p className={hero ? "onboard-error" : "text-sm text-[var(--danger)]"}>
          {error}
        </p>
      ) : null}
      <button
        className={hero ? "onboard-btn" : "btn btn-primary"}
        disabled={pending || (!title.trim() && !spark.trim())}
      >
        {pending
          ? "Starting…"
          : buttonLabel ??
            "Start chat on this repo"}
      </button>
    </form>
  );
}
