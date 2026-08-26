"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function ActionBar({
  changeRequestId,
  status,
  role,
  hasPlan,
}: {
  changeRequestId: string;
  status: string;
  role: string;
  hasPlan: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function postAction(action: string) {
    startTransition(async () => {
      await fetch(`/api/change-requests/${changeRequestId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      router.refresh();
    });
  }

  return (
    <div className="panel flex flex-col gap-2 p-5">
      <h2 className="text-lg">Actions</h2>
      {status === "AWAITING_PLAN_APPROVAL" && hasPlan ? (
        <button
          className="btn btn-primary"
          disabled={pending}
          onClick={() => postAction("approve_plan")}
        >
          Approve plan & implement
        </button>
      ) : null}

      {status === "PREVIEW_READY" || status === "CHANGES_REQUESTED" ? (
        <button
          className="btn btn-primary"
          disabled={pending}
          onClick={() => postAction("submit_review")}
        >
          Submit for review
        </button>
      ) : null}

      {status === "AWAITING_HIGH_RISK_APPROVAL" &&
      (role === "DEVELOPER" || role === "ADMIN") ? (
        <button
          className="btn btn-primary"
          disabled={pending}
          onClick={() => postAction("approve_high_risk")}
        >
          Approve high-risk implementation
        </button>
      ) : null}

      {(status === "READY_FOR_REVIEW" ||
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
            Merge to main
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

      {!["MERGED", "DEPLOYED", "REJECTED", "CANCELLED"].includes(status) ? (
        <button
          className="btn btn-ghost"
          disabled={pending}
          onClick={() => postAction("cancel")}
        >
          Cancel request
        </button>
      ) : null}
    </div>
  );
}
