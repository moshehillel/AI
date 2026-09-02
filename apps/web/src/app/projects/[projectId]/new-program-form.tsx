"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function NewProgramForm({
  projectId,
  variant = "default",
  intent = "plan",
  buttonLabel,
}: {
  projectId: string;
  variant?: "default" | "hero";
  /** Use "iterate" when the project already has a linked GitHub repo with code. */
  intent?: "plan" | "iterate";
  buttonLabel?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [spark, setSpark] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hero = variant === "hero";
  const iterate = intent === "iterate";

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
              intent,
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
                : iterate
                  ? "Add a name or a short note about what to improve"
                  : "Add a program name or a short note to start",
            );
            return;
          }
          router.push(`/change-requests/${json.id}`);
        });
      }}
    >
      {!hero ? (
        <p className="text-sm muted">
          {iterate
            ? "Koda plans against the linked repository — describe the change you want."
            : "Koda will ask clarifying questions one at a time — not a long form."}
        </p>
      ) : null}
      <input
        className={hero ? "onboard-field" : "field"}
        placeholder={iterate ? "What are we improving?" : "Program name"}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label={iterate ? "Improvement name" : "Program name"}
      />
      <textarea
        className={hero ? "onboard-field onboard-field-area" : "field min-h-24"}
        placeholder={
          hero
            ? "What should we automate?"
            : iterate
              ? "Optional: what should change in the existing code (or leave blank and let Koda ask)"
              : "Optional: a sentence about what you want to automate (or leave blank and let Koda ask)"
        }
        value={spark}
        onChange={(e) => setSpark(e.target.value)}
        aria-label={iterate ? "What to improve" : "What to automate"}
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
            (iterate ? "Start chat on this repo" : "Start planning with Koda")}
      </button>
    </form>
  );
}
