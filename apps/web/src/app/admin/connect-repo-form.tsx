"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function ConnectRepoForm({
  projectId,
  defaultInstallationId,
}: {
  projectId: string;
  defaultInstallationId?: string;
}) {
  const router = useRouter();
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [installationId, setInstallationId] = useState(
    defaultInstallationId ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await fetch("/api/repositories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              githubOwner: owner,
              githubRepo: repo,
              installationId: installationId || null,
            }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!res.ok) {
            setError(data.error ?? "Could not connect repository");
            return;
          }
          router.refresh();
        });
      }}
    >
      <p className="muted text-xs">
        Attach an existing GitHub repo (GitHub App must already have access).
      </p>
      <div className="grid gap-2 md:grid-cols-4">
        <input
          className="field"
          placeholder="owner"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          required
          disabled={pending}
        />
        <input
          className="field"
          placeholder="repo"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          required
          disabled={pending}
        />
        <input
          className="field"
          placeholder="installation id"
          value={installationId}
          onChange={(e) => setInstallationId(e.target.value)}
          disabled={pending}
        />
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Connecting…" : "Connect"}
        </button>
      </div>
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
    </form>
  );
}
