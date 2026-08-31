"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useTransition } from "react";

function StaffUnlockForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const next = params.get("next") ?? "/review";

  // Drop legacy ?token= from the address bar so secrets never linger in history.
  useEffect(() => {
    if (!params.get("token")) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }, [params]);

  function unlock() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/staff/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, role: "developer", next }),
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
        <h1 className="brand-mark text-3xl">Staff login</h1>
        <p className="muted text-sm">
          Enter the admin password to open developer tools on this browser. The
          public customer site stays open without login.
        </p>
        <label className="block space-y-1.5">
          <span className="text-sm muted">Password</span>
          <input
            className="field"
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && password.trim() && !pending) unlock();
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={pending || !password.trim()}
          onClick={unlock}
        >
          {pending ? "Signing in…" : "Continue as developer"}
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
