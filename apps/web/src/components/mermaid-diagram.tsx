"use client";

import { useEffect, useId, useRef, useState } from "react";

type MermaidVariant = "default" | "submit";

function loadMermaid(variant: MermaidVariant) {
  const isSubmit = variant === "submit";
  return import("mermaid").then((mod) => {
    mod.default.initialize({
      startOnLoad: false,
      theme: "neutral",
      securityLevel: isSubmit ? "loose" : "strict",
      fontFamily: "var(--font-body, system-ui, sans-serif)",
      flowchart: {
        htmlLabels: true,
        curve: "basis",
        padding: isSubmit ? 18 : 8,
        nodeSpacing: isSubmit ? 42 : 28,
        rankSpacing: isSubmit ? 52 : 36,
        useMaxWidth: true,
      },
    });
    return mod.default;
  });
}

export function MermaidDiagram({
  chart,
  className = "",
  variant = "default",
}: {
  chart: string;
  className?: string;
  /** Larger spacing and html labels for the submit confirmation modal. */
  variant?: MermaidVariant;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderId = useId().replace(/:/g, "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    void (async () => {
      const mermaid = await loadMermaid(variant);
      if (cancelled || !containerRef.current) return;

      try {
        const { svg } = await mermaid.render(`koda-mmd-${renderId}`, chart);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch {
        if (!cancelled) {
          setError("Could not render diagram");
          if (containerRef.current) containerRef.current.innerHTML = "";
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart, renderId, variant]);

  return (
    <div className={`mermaid-diagram-wrap ${className}`.trim()}>
      <div
        ref={containerRef}
        className="mermaid-diagram"
        role="img"
        aria-label="Plan diagram"
      />
      {error ? (
        <p className="mermaid-diagram-error muted text-sm">{error}</p>
      ) : null}
    </div>
  );
}
