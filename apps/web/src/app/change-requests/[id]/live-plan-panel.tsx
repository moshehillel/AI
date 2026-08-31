"use client";

import { useEffect, useState } from "react";

type Plan = {
  id: string;
  content: string;
  updatedAt?: string;
  createdAt?: string;
};

export function LivePlanPanel({
  changeRequestId,
  initialPlan,
}: {
  changeRequestId: string;
  initialPlan: Plan | null;
}) {
  const [plan, setPlan] = useState<Plan | null>(initialPlan);

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
    <div className="plan-doc panel overflow-hidden">
      <div className="plan-doc-header">
        <div>
          <p className="muted text-xs uppercase tracking-[0.14em]">Living plan</p>
          <h2 className="text-lg">Plan</h2>
        </div>
        {plan ? (
          <span className="muted text-xs pulse-soft">Updates as you chat</span>
        ) : (
          <span className="muted text-xs">Drafting…</span>
        )}
      </div>
      {plan ? (
        <pre className="plan-doc-body muted whitespace-pre-wrap text-sm leading-relaxed">
          {plan.content}
        </pre>
      ) : (
        <p className="muted px-5 pb-5 text-sm">
          Koda keeps a living plan here — goals, systems, workflow, diagrams,
          and acceptance checks — refreshed as the conversation progresses.
        </p>
      )}
    </div>
  );
}
