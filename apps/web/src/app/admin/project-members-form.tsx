"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
  const [userId, setUserId] = useState(candidates[0]?.userId ?? "");
  const [pending, startTransition] = useTransition();

  async function mutate(action: "add" | "remove", targetUserId: string) {
    startTransition(async () => {
      await fetch("/api/project-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, userId: targetUserId, action }),
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="muted text-sm">Project members</p>
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
              onClick={() => mutate("remove", member.userId)}
            >
              Remove
            </button>
          </li>
        ))}
        {members.length === 0 ? (
          <li className="muted">No project members assigned.</li>
        ) : null}
      </ul>
      <div className="flex gap-2">
        <select
          className="field"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        >
          {candidates.map((c) => (
            <option key={c.userId} value={c.userId}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          className="btn btn-primary"
          disabled={pending || !userId}
          onClick={() => mutate("add", userId)}
        >
          Assign
        </button>
      </div>
    </div>
  );
}
