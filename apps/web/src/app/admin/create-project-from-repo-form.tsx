"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function CreateProjectFromRepoForm({
  defaultInstallationId,
}: {
  defaultInstallationId?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [installationId, setInstallationId] = useState(
    defaultInstallationId ?? "",
  );
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
              name: name.trim() || undefined,
              githubOwner: owner.trim(),
              githubRepo: repo.trim(),
              installationId: installationId.trim() || null,
            }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            project?: { id: string };
          };
          if (!res.ok) {
            setError(data.error ?? "Could not create project from repository");
            return;
          }
          setName("");
          setOwner("");
          setRepo("");
          router.refresh();
        });
      }}
    >
      <div>
        <h3 className="text-base font-medium">Add existing GitHub repo</h3>
        <p className="muted mt-1 text-xs">
          Creates a Koda project linked to a repository the GitHub App can
          already access. Then assign a Clerk user below so they can open it and
          chat against that codebase.
        </p>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <input
          className="field"
          placeholder="Project name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
        />
        <input
          className="field"
          placeholder="installation id"
          value={installationId}
          onChange={(e) => setInstallationId(e.target.value)}
          disabled={pending}
        />
        <input
          className="field"
          placeholder="owner (org or user)"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          required
          disabled={pending}
        />
        <input
          className="field"
          placeholder="repo name"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          required
          disabled={pending}
        />
      </div>
      <button
        className="btn btn-primary"
        disabled={pending || !owner.trim() || !repo.trim()}
      >
        {pending ? "Creating…" : "Create project from repo"}
      </button>
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
    </form>
  );
}
