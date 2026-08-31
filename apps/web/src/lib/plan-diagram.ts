/** Extract ```mermaid fence from plan or chat markdown. */
export function extractMermaidFromMarkdown(markdown: string): string | null {
  const match = markdown.match(/```mermaid\s*\r?\n([\s\S]*?)```/i);
  return match?.[1]?.trim() ?? null;
}

function extractSection(markdown: string, heading: string): string | null {
  const re = new RegExp(
    `## ${heading}\\s*\\n([\\s\\S]*?)(?:\\n## |\\n*$)`,
    "i",
  );
  const m = markdown.match(re);
  return m?.[1]?.trim() ?? null;
}

/** Safe short label for mermaid node text. */
function mermaidLabel(text: string, max = 56): string {
  const cleaned = text
    .replace(/["[\]{}|#;]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return cleaned || "Step";
}

/**
 * Prefer mermaid embedded in the living plan; otherwise build a simple
 * goal → steps → destination flowchart from plan sections.
 */
export function resolvePlanMermaid(planMarkdown: string): string {
  const existing = extractMermaidFromMarkdown(planMarkdown);
  if (existing) return existing;

  const goal =
    extractSection(planMarkdown, "Goal")?.split("\n")[0]?.trim() ??
    "Your automation goal";

  const workflowSection = extractSection(planMarkdown, "Workflow");
  const steps: string[] = [];
  if (workflowSection) {
    for (const line of workflowSection.split("\n")) {
      const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (numbered?.[1]) {
        steps.push(numbered[1].trim());
        continue;
      }
      const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
      if (bullet?.[1]) steps.push(bullet[1].trim());
    }
  }

  const systemsSection = extractSection(planMarkdown, "Systems");
  const systems: string[] = [];
  if (systemsSection) {
    for (const line of systemsSection.split("\n")) {
      const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
      if (bullet?.[1] && !/to be confirmed/i.test(bullet[1])) {
        systems.push(bullet[1].trim());
      }
    }
  }

  if (steps.length >= 2) {
    const lines = ["flowchart TD", `  goal(["${mermaidLabel(goal)}"])`];
    steps.forEach((step, i) => {
      const id = `step${i}`;
      lines.push(`  ${id}["${mermaidLabel(step)}"]`);
      if (i === 0) lines.push(`  goal --> ${id}`);
      else lines.push(`  step${i - 1} --> ${id}`);
    });
    const dest = systems[systems.length - 1] ?? "Complete";
    lines.push(`  done(["${mermaidLabel(dest)}"])`);
    lines.push(`  step${steps.length - 1} --> done`);
    return lines.join("\n");
  }

  if (systems.length >= 2) {
    const lines = ["flowchart LR"];
    systems.forEach((sys, i) => {
      lines.push(`  sys${i}["${mermaidLabel(sys)}"]`);
      if (i > 0) lines.push(`  sys${i - 1} --> sys${i}`);
    });
    return lines.join("\n");
  }

  const destination = systems[0] ?? "Destination";
  return [
    "flowchart LR",
    `  goal["${mermaidLabel(goal)}"]`,
    '  auto["Koda automation"]',
    `  dest["${mermaidLabel(destination)}"]`,
    "  goal --> auto --> dest",
  ].join("\n");
}
