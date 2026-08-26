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
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="grid gap-2 md:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          await fetch("/api/repositories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              githubOwner: owner,
              githubRepo: repo,
              installationId: installationId || null,
            }),
          });
          router.refresh();
        });
      }}
    >
      <input
        className="field"
        placeholder="owner"
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
        required
      />
      <input
        className="field"
        placeholder="repo"
        value={repo}
        onChange={(e) => setRepo(e.target.value)}
        required
      />
      <input
        className="field"
        placeholder="installation id"
        value={installationId}
        onChange={(e) => setInstallationId(e.target.value)}
      />
      <button className="btn btn-primary" disabled={pending}>
        Connect
      </button>
    </form>
  );
}
