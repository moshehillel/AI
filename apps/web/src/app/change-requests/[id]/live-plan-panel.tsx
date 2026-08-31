"use client";

import { useEffect, useState } from "react";
import { MarkdownBody } from "@/components/markdown-body";

type Plan = {
  id: string;
  content: string;
  updatedAt?: string;
  createdAt?: string;
};

export function LivePlanPanel({
  changeRequestId,
  initialPlan,
  compact = false,
}: {
  changeRequestId: string;
  initialPlan: Plan | null;
  compact?: boolean;
}) {
  const [plan, setPlan] = useState<Plan | null>(initialPlan);
  const [tab, setTab] = useState<"plan" | "context">("plan");

  useEffect(() => {
    const source = new EventSource(
      `/api/change-requests/${changeRequestId}/events`,
    );
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          type: string;
          plan?: Plan | null;
        };
        if (data.type === "snapshot" && data.plan) {
          setPlan(data.plan);
        }
      } catch {
        // ignore malformed events
      }
    };
    return () => source.close();
  }, [changeRequestId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="ide-right-section">
        <p className="ide-right-label">Open tabs</p>
        <div className="ide-tab-row">
          <button
            type="button"
            className={`ide-tab ${tab === "plan" ? "is-active" : ""}`}
            onClick={() => setTab("plan")}
          >
            Plan
          </button>
          <button
            type="button"
            className={`ide-tab ${tab === "context" ? "is-active" : ""}`}
            onClick={() => setTab("context")}
          >
            Context
          </button>
        </div>
      </div>

      <div className="ide-right-section">
        <p className="ide-right-label">On this program</p>
        <div
          className="space-y-1 text-[12px]"
          style={{ color: "var(--ide-chrome-ink-secondary)" }}
        >
          <div className="flex items-center justify-between gap-2">
            <span>Living plan</span>
            <span className="muted text-[11px]">
              {plan ? "Updates as you chat" : "Drafting…"}
            </span>
          </div>
        </div>
      </div>

      <div className="ide-right-section">
        <p className="ide-right-label">{tab === "plan" ? "Plan" : "Context"}</p>
        {tab === "plan" ? (
          plan ? (
            <MarkdownBody content={plan.content} className="plan-doc-body" />
          ) : (
            <p className="muted text-[12px] leading-relaxed">
              Koda keeps a living plan here — goals, systems, workflow, and
              acceptance checks — refreshed as you chat.
            </p>
          )
        ) : (
          <p className="muted text-[12px] leading-relaxed">
            {compact
              ? "Attachments, notes, and securely stored secret names from this session appear in chat. Use Add secrets / credentials for passwords — values never show in the plan."
              : "Use chat attachments for docs, examples, and files. Use Add secrets / credentials for passwords and API keys. Nothing from internal tooling is shown here."}
          </p>
        )}
      </div>
    </div>
  );
}
