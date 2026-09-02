"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

export function ProjectMembersForm({
  projectId,
  members,
  candidates,
}: {
  projectId: string;
  members: Array<{ userId: string; label: string }>;
  candidates: Array<{ userId: string; label: string }>;
}) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const available = useMemo(() => {
    const assigned = new Set(members.map((m) => m.userId));
    return candidates.filter((c) => !assigned.has(c.userId));
  }, [candidates, members]);

  const selectedUserId = userId || available[0]?.userId || "";

  async function mutate(
    action: "add" | "remove",
    target: { userId?: string; email?: string },
  ) {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/project-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          action,
          ...(target.userId ? { userId: target.userId } : {}),
          ...(target.email ? { email: target.email } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not update project members");
        return;
      }
      if (action === "add") {
        setEmail("");
        setUserId("");
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="muted text-sm">Project members</p>
      <p className="muted text-xs">
        Assign an existing Clerk login so they can open this project and continue
        planning chat. Create the account in Clerk first (no public sign-up).
      </p>
      <ul className="space-y-2 text-sm">
        {members.map((member) => (
          <li
            key={member.userId}
            className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] px-3 py-2"
          >
            <span>{member.label}</span>
            <button
              className="btn btn-ghost py-1"
              disabled={pending}
              onClick={() => mutate("remove", { userId: member.userId })}
            >
              Remove
            </button>
          </li>
        ))}
        {members.length === 0 ? (
          <li className="muted">No project members assigned.</li>
        ) : null}
      </ul>

      <div className="flex flex-wrap gap-2">
        <input
          className="field min-w-[14rem] flex-1"
          type="email"
          placeholder="Add by Clerk email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
        />
        <button
          className="btn btn-primary"
          disabled={pending || !email.trim()}
          onClick={() => mutate("add", { email: email.trim() })}
        >
          Assign by email
        </button>
      </div>

      {available.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <select
            className="field min-w-[14rem] flex-1"
            value={selectedUserId}
            onChange={(e) => setUserId(e.target.value)}
            disabled={pending}
          >
            {available.map((c) => (
              <option key={c.userId} value={c.userId}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            className="btn btn-ghost"
            disabled={pending || !selectedUserId}
            onClick={() => mutate("add", { userId: selectedUserId })}
          >
            Assign member
          </button>
        </div>
      ) : (
        <p className="muted text-xs">
          No unassigned company members. Use email above for an existing Clerk
          user, or invite them to the Clerk organization first.
        </p>
      )}

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
