"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useTransition } from "react";

function StaffUnlockForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showReset, setShowReset] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetPending, startResetTransition] = useTransition();
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

  function changePassword() {
    setResetMessage(null);
    setResetError(null);
    if (newPassword !== confirmPassword) {
      setResetError("New passwords do not match");
      return;
    }
    startResetTransition(async () => {
      const res = await fetch("/api/staff/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setResetError(data.error ?? "Could not change password");
        return;
      }
      setResetMessage(
        "Password updated. Use the new password on this browser; existing staff sessions stay signed in.",
      );
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    });
  }

  return (
    <main className="app-frame-narrow space-y-4">
      <section className="panel rise space-y-4 p-6">
        <h1 className="brand-mark text-3xl">Staff login</h1>
        <p className="muted text-sm">
          Enter the admin password to open developer tools on this browser when
          you do not have a Clerk developer or admin role. With Clerk auth,
          sign in with an org:developer or org:admin account instead.
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

      <section className="panel rise space-y-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Change staff password</h2>
          <button
            type="button"
            className="btn btn-ghost text-sm"
            onClick={() => setShowReset((v) => !v)}
          >
            {showReset ? "Hide" : "Show"}
          </button>
        </div>
        {showReset ? (
          <>
            <p className="muted text-sm">
              Updates the staff login password for this deployment. The current
              password is required. Env-based <code>ADMIN_PASSWORD</code> in AWS
              Secrets Manager still works until you change it there too.
            </p>
            <label className="block space-y-1.5">
              <span className="text-sm muted">Current password</span>
              <input
                className="field"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm muted">New password</span>
              <input
                className="field"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm muted">Confirm new password</span>
              <input
                className="field"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary w-full"
              disabled={
                resetPending ||
                !currentPassword.trim() ||
                !newPassword.trim() ||
                !confirmPassword.trim()
              }
              onClick={changePassword}
            >
              {resetPending ? "Saving…" : "Update password"}
            </button>
            {resetError ? (
              <p className="text-sm text-[var(--danger)]">{resetError}</p>
            ) : null}
            {resetMessage ? (
              <p className="text-sm text-[var(--success)]">{resetMessage}</p>
            ) : null}
          </>
        ) : (
          <p className="muted text-sm">
            Need a different staff password? Expand to change it without
            redeploying ECS.
          </p>
        )}
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
