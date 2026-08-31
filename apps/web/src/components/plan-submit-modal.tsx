"use client";

import { useEffect, useRef, useState } from "react";
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
  const [understood, setUnderstood] = useState(false);
  const summary = buildSubmitSummary(planMarkdown);
  const customMermaid = getMeaningfulPlanMermaid(planMarkdown);

  useEffect(() => {
    if (!open) {
      setUnderstood(false);
      return;
    }
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
            Review this summary carefully. After you submit,{" "}
            <strong>you cannot continue planning</strong> or change the plan
            here. Make sure you are fully comfortable with the plan first — your
            developer will build from this version.
          </p>
        </header>

        <div
          className="plan-submit-warning"
          role="note"
          style={{
            margin: "0 0 1rem",
            padding: "0.75rem 1rem",
            borderRadius: "0.75rem",
            border: "1px solid color-mix(in oklab, var(--ide-warn) 45%, transparent)",
            background:
              "color-mix(in oklab, var(--ide-warn) 10%, transparent)",
            fontSize: "0.875rem",
            lineHeight: 1.5,
          }}
        >
          When the build is ready, a separate <strong>Test & request changes</strong>{" "}
          chat will open so you can try the preview and ask for edits. That is
          not planning mode — the plan itself stays locked after submit.
        </div>

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

        <label
          className="plan-submit-ack flex items-start gap-2 text-sm"
          style={{ marginBottom: "1rem", cursor: "pointer" }}
        >
          <input
            type="checkbox"
            checked={understood}
            disabled={pending}
            onChange={(e) => setUnderstood(e.target.checked)}
            style={{ marginTop: "0.2rem" }}
          />
          <span>
            I understand I cannot change the plan after submit. I am comfortable
            sending this plan to a developer for building.
          </span>
        </label>

        <div className="plan-submit-actions">
          <button
            ref={confirmRef}
            type="button"
            className="btn btn-primary w-full"
            disabled={pending || !understood}
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
