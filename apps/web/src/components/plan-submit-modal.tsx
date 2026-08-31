"use client";

import { useEffect, useRef } from "react";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import {
  buildSubmitSummary,
  getMeaningfulPlanMermaid,
} from "@/lib/plan-submit-summary";

export function PlanSubmitModal({
  open,
  planMarkdown,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  planMarkdown: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const summary = buildSubmitSummary(planMarkdown);
  const customMermaid = getMeaningfulPlanMermaid(planMarkdown);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending, onCancel]);

  if (!open) return null;

  return (
    <div
      className="plan-submit-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-submit-title"
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div className="plan-submit-modal rise">
        <header className="plan-submit-header">
          <p className="plan-submit-kicker">Koda</p>
          <h2 id="plan-submit-title" className="plan-submit-title">
            Here&apos;s what we understood
          </h2>
          <p className="plan-submit-caption">
            Review this summary, then send it to a developer for building. You
            can reopen planning later if something needs to change.
          </p>
        </header>

        <div className="plan-submit-summary">
          <ul className="plan-submit-summary-list">
            {summary.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </div>

        {customMermaid ? (
          <div
            className="plan-submit-diagram"
            aria-label="Automation workflow diagram"
          >
            <MermaidDiagram chart={customMermaid} variant="submit" />
          </div>
        ) : null}

        <div className="plan-submit-actions">
          <button
            ref={confirmRef}
            type="button"
            className="btn btn-primary w-full"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Submitting…" : "Yes, submit for building"}
          </button>
          <button
            type="button"
            className="btn btn-ghost w-full"
            disabled={pending}
            onClick={onCancel}
          >
            Keep planning
          </button>
        </div>
      </div>
    </div>
  );
}
