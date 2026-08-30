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
    <div className="panel p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg">Plan</h2>
        {plan ? (
          <span className="muted text-xs">Updates as you chat</span>
        ) : (
          <span className="muted text-xs">Living document</span>
        )}
      </div>
      {plan ? (
        <pre className="muted mt-3 max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
          {plan.content}
        </pre>
      ) : (
        <p className="muted mt-3 text-sm">
          Koda will keep a markdown plan here — goals, systems, workflow,
          diagrams, and acceptance checks — and refresh it as the conversation
          progresses.
        </p>
      )}
    </div>
  );
}
