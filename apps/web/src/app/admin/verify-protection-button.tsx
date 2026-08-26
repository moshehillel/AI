"use client";

import { useState, useTransition } from "react";

export function VerifyProtectionButton({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        className="btn btn-ghost"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const response = await fetch("/api/repositories/verify-protection", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projectId }),
            });
            const json = (await response.json()) as {
              protection?: {
                protected: boolean;
                requiresReviews: boolean;
                requiresStatusChecks: boolean;
              };
              error?: string;
            };
            if (!response.ok) {
              setResult(json.error ?? "Verification failed");
              return;
            }
            const p = json.protection!;
            setResult(
              p.protected
                ? `Protected · reviews=${p.requiresReviews} · checks=${p.requiresStatusChecks}`
                : "main is NOT protected",
            );
          });
        }}
      >
        Verify protection
      </button>
      {result ? <span className="muted text-xs">{result}</span> : null}
    </div>
  );
}
