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

/** Count distinct node definitions in a mermaid flowchart. */
export function countMermaidNodes(mermaid: string): number {
  const ids = new Set<string>();
  const patterns = [
    /\b([A-Za-z][\w-]*)\s*\[\["([^"]*)"\]\]/g,
    /\b([A-Za-z][\w-]*)\s*\(\("([^"]*)"\)\)/g,
    /\b([A-Za-z][\w-]*)\s*\(\["([^"]*)"\]\)/g,
    /\b([A-Za-z][\w-]*)\s*\["([^"]*)"\]/g,
    /\b([A-Za-z][\w-]*)\s*\("([^"]*)"\)/g,
    /\b([A-Za-z][\w-]*)\s*\[([^\]\n]+)\]/g,
    /\b([A-Za-z][\w-]*)\s*\{([^}\n]+)\}/g,
    /\b([A-Za-z][\w-]*)\s*\(\(([^)\n]+)\)\)/g,
    /\b([A-Za-z][\w-]*)\s*\(([^)\n]+)\)/g,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(mermaid)) !== null) {
      ids.add(m[1]!);
    }
  }

  return ids.size;
}

/** True when the diagram has enough boxes to explain the workflow (not a generic 3-box). */
export function isDetailedMermaid(mermaid: string, minNodes = 5): boolean {
  return countMermaidNodes(mermaid) >= minNodes;
}

/** Escape and wrap label text for mermaid nodes — no truncation. */
export function mermaidLabel(text: string, wrapAt = 42): string {
  const cleaned = text
    .replace(/["[\]{}|#;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Step";

  const words = cleaned.split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > wrapAt && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);

  return lines.join("<br/>");
}

function parseListItems(section: string): string[] {
  const items: string[] = [];
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (numbered?.[1]) {
      items.push(numbered[1].trim());
      continue;
    }

    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (bullet?.[1]) items.push(bullet[1].trim());
  }
  return items;
}

function splitCompoundStep(step: string): string[] {
  const parts = step
    .split(/\s*(?:→|->|-->|,\s*then\s+|;\s+|,\s+and then\s+|\s+then\s+)/i)
    .map((p) => p.replace(/^and\s+/i, "").trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [step];
}

function parseWorkflowSteps(workflowSection: string | null): string[] {
  if (!workflowSection) return [];

  const steps: string[] = [];
  for (const item of parseListItems(workflowSection)) {
    for (const part of splitCompoundStep(item)) {
      if (part && !steps.includes(part)) steps.push(part);
    }
  }
  return steps;
}

function parseSystems(systemsSection: string | null): string[] {
  if (!systemsSection) return [];
  return parseListItems(systemsSection).filter(
    (s) => !/^to be confirmed/i.test(s),
  );
}

function inferStepsFromGoal(goal: string): string[] {
  const lower = goal.toLowerCase();
  const inferred: string[] = [];

  const push = (cond: boolean, label: string) => {
    if (cond && !inferred.includes(label)) inferred.push(label);
  };

  push(/\bupload/i.test(goal), "User uploads source file");
  push(/\bextract|parse|read|pull|export|fetch/i.test(goal), "Extract and normalize source data");
  push(/\bcalculat|compute|total|sum|derive/i.test(goal), "Calculate derived amounts and totals");
  push(/\bmap|match|convert|transform|code/i.test(goal), "Map codes and translate fields");
  push(/\bexcel|spreadsheet|template|fill|write/i.test(goal), "Fill output spreadsheet / template");
  push(/\bvalidat|verify|check|qa/i.test(goal), "Validate required fields and business rules");
  push(/\bnotif|alert|slack|email/i.test(goal), "Notify team on failures or exceptions");
  push(/\bdownload|deliver|export|send|push|sync/i.test(goal), "Deliver or sync completed output");
  push(/\bretry|recover|error|fail/i.test(goal), "Surface errors for review and retry");

  if (inferred.length >= 3) return inferred;

  if (lower.length > 20) {
    const clauses = goal
      .split(/[,;]\s+|\s+and\s+/i)
      .map((c) => c.trim())
      .filter((c) => c.length > 8 && c.length < 120);
    if (clauses.length >= 3) return clauses.slice(0, 10);
  }

  return inferred;
}

function defaultAutomationSteps(systems: string[]): string[] {
  const source = systems[0] ?? "Source system";
  const dest = systems[systems.length - 1] ?? "Destination system";
  const middle =
    systems.length > 2
      ? systems.slice(1, -1).map((s) => `Integrate with ${s}`)
      : [];

  return [
    `Trigger from ${source}`,
    "Validate and normalize incoming payload",
    ...middle,
    `Write results to ${dest}`,
    "Record success and surface failures for review",
  ];
}

function expandToDetailedSteps(
  steps: string[],
  systems: string[],
  goal: string,
  minSteps = 5,
): string[] {
  let expanded = [...steps];

  if (expanded.length === 0) {
    expanded = inferStepsFromGoal(goal);
  }

  if (expanded.length === 0 && systems.length >= 2) {
    expanded = defaultAutomationSteps(systems);
  }

  if (expanded.length < minSteps && systems.length >= 2) {
    const source = systems[0]!;
    const dest = systems[systems.length - 1]!;
    const pad: string[] = [
      `Receive event or file from ${source}`,
      "Validate and normalize payload fields",
    ];
    for (const sys of systems.slice(1, -1)) {
      pad.push(`Call / sync with ${sys}`);
    }
    pad.push(`Write mapped data to ${dest}`);
    pad.push("Log outcome and notify on failure");

    const merged = [...expanded];
    for (const p of pad) {
      if (!merged.some((s) => s.toLowerCase() === p.toLowerCase())) {
        merged.push(p);
      }
    }
    expanded = merged;
  }

  if (expanded.length < minSteps) {
    const fillers = [
      "Detect trigger or scheduled run",
      "Extract and transform source records",
      "Apply business rules and calculations",
      "Validate output against acceptance criteria",
      "Complete handoff and audit trail",
    ];
    for (const f of fillers) {
      if (expanded.length >= minSteps) break;
      if (!expanded.some((s) => s.toLowerCase().includes(f.slice(0, 12).toLowerCase()))) {
        expanded.push(f);
      }
    }
  }

  return expanded.slice(0, 14);
}

function nodeId(index: number): string {
  return `n${index}`;
}

/** Build a top-down flowchart with one box per workflow step. */
export function buildDetailedPlanMermaid(opts: {
  goal: string;
  steps: string[];
  systems: string[];
}): string {
  const { goal, systems } = opts;
  const steps = expandToDetailedSteps(opts.steps, systems, goal);
  const lines = ["flowchart TD"];

  lines.push(`  ${nodeId(0)}(["${mermaidLabel(goal)}"])`);

  steps.forEach((step, i) => {
    const id = nodeId(i + 1);
    lines.push(`  ${id}["${mermaidLabel(step)}"]`);
    lines.push(`  ${nodeId(i)} --> ${id}`);
  });

  const destination =
    systems.length > 0
      ? `Complete — ${systems[systems.length - 1]}`
      : "Automation complete";
  const doneId = nodeId(steps.length + 1);
  lines.push(`  ${doneId}(["${mermaidLabel(destination)}"])`);
  lines.push(`  ${nodeId(steps.length)} --> ${doneId}`);

  return lines.join("\n");
}

/**
 * Prefer mermaid embedded in the living plan when it is detailed enough;
 * otherwise build a multi-step flowchart from Goal, Workflow, and Systems.
 */
export function resolvePlanMermaid(planMarkdown: string): string {
  const goal =
    extractSection(planMarkdown, "Goal")
      ?.split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "Your automation goal";

  const workflowSteps = parseWorkflowSteps(
    extractSection(planMarkdown, "Workflow"),
  );
  const systems = parseSystems(extractSection(planMarkdown, "Systems"));

  const built = buildDetailedPlanMermaid({
    goal,
    steps: workflowSteps,
    systems,
  });

  const existing = extractMermaidFromMarkdown(planMarkdown);
  if (existing && isDetailedMermaid(existing)) {
    return existing;
  }

  if (
    existing &&
    countMermaidNodes(existing) >= countMermaidNodes(built)
  ) {
    return existing;
  }

  return built;
}
