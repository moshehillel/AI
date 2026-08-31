"use client";

import { useEffect, useId, useRef, useState } from "react";

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        theme: "neutral",
        securityLevel: "strict",
        fontFamily: "var(--font-body, system-ui, sans-serif)",
      });
      return mod.default;
    });
  }
  return mermaidReady;
}

export function MermaidDiagram({
  chart,
  className = "",
}: {
  chart: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderId = useId().replace(/:/g, "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    void (async () => {
      const mermaid = await loadMermaid();
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
  }, [chart, renderId]);

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
