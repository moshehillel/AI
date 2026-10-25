"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function CreatePlanningProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name.trim(),
              description: description.trim() || undefined,
            }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!res.ok) {
            setError(data.error ?? "Could not open project");
            return;
          }
          setName("");
          setDescription("");
          router.refresh();
        });
      }}
    >
      <div>
        <h3 className="text-base font-medium">Open a planning project</h3>
        <p className="muted mt-1 text-xs">
          Opens a project and its chat. Assign a user below. They chat inside
          this project to change it. They cannot create a project.
        </p>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <input
          className="field"
          placeholder="Project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          disabled={pending}
        />
        <input
          className="field"
          placeholder="Short description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={pending}
        />
      </div>
      <button className="btn btn-primary" disabled={pending || name.trim().length < 2}>
        {pending ? "Opening…" : "Open project"}
      </button>
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
    </form>
  );
}
