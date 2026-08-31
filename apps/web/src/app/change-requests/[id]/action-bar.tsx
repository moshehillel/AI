"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function ActionBar({
  changeRequestId,
  status,
  role,
  hasPlan,
  kind,
  projectId,
  hideProgramBuild = false,
}: {
  changeRequestId: string;
  status: string;
  role: string;
  hasPlan: boolean;
  kind: string;
  projectId: string;
  hideProgramBuild?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverLabel, setServerLabel] = useState("Production server");
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const isProgram = kind === "PROGRAM";
  const isStaff = role === "DEVELOPER" || role === "ADMIN";

  async function postAction(action: string, extra?: Record<string, unknown>) {
    setActionError(null);
    startTransition(async () => {
      const res = await fetch(`/api/change-requests/${changeRequestId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        redirectTo?: string;
        cancelled?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setActionError(data.error ?? "Action failed — try again.");
        return;
      }
      if (action === "cancel" && (data.redirectTo || data.cancelled)) {
        router.push(data.redirectTo ?? `/projects/${projectId}`);
        router.refresh();
        return;
      }
      setConfirmSubmit(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="ide-right-label">Actions</p>

      {isProgram && (status === "PLANNING" || status === "AWAITING_PLAN_APPROVAL") ? (
        !confirmSubmit ? (
          <button
            className="btn btn-ghost"
            disabled={pending}
            onClick={() => {
              setActionError(null);
              setConfirmSubmit(true);
            }}
          >
            Ready to submit to a developer?
          </button>
        ) : (
          <div className="space-y-2 rounded-xl border border-[var(--line)] p-3">
            <p className="text-sm">
              Confirms handoff for building and notifies the developer. Chat and
              attach never submit on their own.
            </p>
            <button
              className="btn btn-primary w-full"
              disabled={pending}
              onClick={() =>
                postAction("submit_to_dev", { confirmSubmit: true })
              }
            >
              Yes, submit for building
            </button>
            <button
              className="btn btn-ghost w-full"
              disabled={pending}
              onClick={() => setConfirmSubmit(false)}
            >
              Keep planning
            </button>
          </div>
        )
      ) : null}

      {isProgram && status === "AWAITING_DEV_BUILD" ? (
        <button
          className="btn btn-ghost"
          disabled={pending}
          onClick={() => postAction("reopen_planning")}
        >
          Continue planning (reopen)
        </button>
      ) : null}

      {isProgram &&
      (status === "AWAITING_DEV_BUILD" || status === "CHANGES_REQUESTED") &&
      isStaff &&
      !hideProgramBuild ? (
        <div className="space-y-3 rounded-xl border border-[var(--line)] p-3">
          <p className="text-sm muted">Build setup</p>
          <input
            className="field"
            value={serverLabel}
            onChange={(e) => setServerLabel(e.target.value)}
            placeholder="Server / environment label"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoDeploy}
              onChange={(e) => setAutoDeploy(e.target.checked)}
            />
            Auto-deploy preview on push
          </label>
          <button
            className="btn btn-primary w-full"
            disabled={pending}
            onClick={() =>
              postAction("start_build", { serverLabel, autoDeploy })
            }
          >
            Start build
          </button>
        </div>
      ) : null}

      {isProgram &&
      (status === "CLIENT_VERIFY" || status === "PREVIEW_READY") ? (
        <button
          className="btn btn-primary"
          disabled={pending}
          onClick={() => postAction("submit_final_review")}
        >
          Submit for final review
        </button>
      ) : null}

      {isProgram &&
      status === "AWAITING_FINAL_REVIEW" &&
      isStaff ? (
        <>
          <button
            className="btn btn-primary"
            disabled={pending}
            onClick={() => postAction("approve_deploy")}
          >
            Approve & deploy
          </button>
          <button
            className="btn btn-ghost"
            disabled={pending}
            onClick={() => postAction("request_changes")}
          >
            Request changes
          </button>
        </>
      ) : null}

      {!isProgram && status === "AWAITING_PLAN_APPROVAL" && hasPlan ? (
        <button
          className="btn btn-primary"
          disabled={pending}
          onClick={() => postAction("approve_plan")}
        >
          Approve plan & implement
        </button>
      ) : null}

      {!isProgram &&
      (status === "PREVIEW_READY" || status === "CHANGES_REQUESTED") ? (
        <button
          className="btn btn-primary"
          disabled={pending}
          onClick={() => postAction("submit_review")}
        >
          Submit for review
        </button>
      ) : null}

      {status === "AWAITING_HIGH_RISK_APPROVAL" && isStaff ? (
        <button
          className="btn btn-primary"
          disabled={pending}
          onClick={() => postAction("approve_high_risk")}
        >
          Approve high-risk implementation
        </button>
      ) : null}

      {!isProgram &&
      (status === "READY_FOR_REVIEW" ||
        status === "DEVELOPER_REVIEW" ||
        status === "APPROVED") &&
      role === "DEVELOPER" ? (
        <>
          {status !== "APPROVED" ? (
            <button
              className="btn btn-primary"
              disabled={pending}
              onClick={() => postAction("approve")}
            >
              Approve
            </button>
          ) : null}
          <button
            className="btn btn-ghost"
            disabled={pending}
            onClick={() => postAction("request_changes")}
          >
            Request changes
          </button>
          <button
            className="btn btn-danger"
            disabled={pending}
            onClick={() => postAction("reject")}
          >
            Reject
          </button>
          <button
            className="btn btn-ghost"
            disabled={pending}
            onClick={() => postAction("merge")}
          >
            Ship to production
          </button>
        </>
      ) : null}

      {status === "FAILED" ? (
        <button
          className="btn btn-primary"
          disabled={pending}
          onClick={() => postAction("retry")}
        >
          Retry
        </button>
      ) : null}

      {!["MERGED", "DEPLOYED", "DONE", "REJECTED", "CANCELLED"].includes(
        status,
      ) ? (
        <button
          className="btn btn-ghost"
          disabled={pending}
          onClick={() => postAction("cancel")}
        >
          Cancel
        </button>
      ) : null}

      {actionError ? (
        <p className="text-sm text-[var(--danger)]">{actionError}</p>
      ) : null}
    </div>
  );
}
