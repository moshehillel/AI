"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error]", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="brand-mark text-3xl">Koda</p>
      <h1 className="text-xl font-medium">Something went wrong</h1>
      <p className="muted text-sm">
        If you just signed in, select an organization and try again. Production
        deploys need a Clerk organization linked to your company.
      </p>
      {error.digest ? (
        <p className="muted text-xs">Digest: {error.digest}</p>
      ) : null}
      <div className="mt-2 flex gap-3">
        <button type="button" className="btn btn-ghost" onClick={reset}>
          Try again
        </button>
        <Link className="btn btn-primary" href="/select-org">
          Select organization
        </Link>
      </div>
    </main>
  );
}
