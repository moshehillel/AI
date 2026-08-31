"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, useTransition } from "react";

function StaffUnlockForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [token, setToken] = useState(params.get("token") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const next = params.get("next") ?? "/review";

  function unlock() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/staff/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, role: "developer", next }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        next?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not unlock developer access");
        return;
      }
      router.push(data.next ?? next);
      router.refresh();
    });
  }

  return (
    <main className="app-frame-narrow">
      <section className="panel rise space-y-4 p-6">
        <h1 className="brand-mark text-3xl">Developer unlock</h1>
        <p className="muted text-sm">
          Opens developer tools on this browser while the public site stays in
          customer mode. Customers never see this page.
        </p>
        <input
          className="field"
          type="password"
          autoComplete="off"
          placeholder="Staff access token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={pending || !token.trim()}
          onClick={unlock}
        >
          {pending ? "Unlocking…" : "Continue as developer"}
        </button>
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      </section>
    </main>
  );
}

export default function StaffPage() {
  return (
    <Suspense
      fallback={
        <main className="app-frame-narrow">
          <div className="panel p-6 muted">Loading…</div>
        </main>
      }
    >
      <StaffUnlockForm />
    </Suspense>
  );
}
