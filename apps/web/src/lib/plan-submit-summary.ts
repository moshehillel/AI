import { extractMermaidFromMarkdown } from "./plan-diagram";

export type PlanSubmitSummary = {
  bullets: string[];
};

function extractSection(markdown: string, heading: string): string | null {
  const re = new RegExp(
    `## ${heading}\\s*\\n([\\s\\S]*?)(?:\\n## |\\n*$)`,
    "i",
  );
  const m = markdown.match(re);
  return m?.[1]?.trim() ?? null;
}

function parseListItems(section: string): string[] {
  const items: string[] = [];
  for (const line of section.split("\n")) {
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (numbered?.[1]) {
      items.push(numbered[1].trim());
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet?.[1]) items.push(bullet[1].trim());
  }
  return items;
}

function parseProvideItems(section: string): Array<{ text: string; done: boolean }> {
  const items: Array<{ text: string; done: boolean }> = [];
  for (const line of section.split("\n")) {
    const unchecked = line.match(/^\s*-\s*\[\s*\]\s*(.+)$/);
    if (unchecked) {
      const text = unchecked[1];
      if (text) items.push({ text: cleanProvideItem(text), done: false });
      continue;
    }
    const checked = line.match(/^\s*-\s*\[x\]\s*(.+)$/i);
    if (checked) {
      const text = checked[1];
      if (text) items.push({ text: cleanProvideItem(text), done: true });
    }
  }
  return items;
}

function cleanProvideItem(text: string): string {
  return text
    .replace(/\s*—\s*use Add secrets \/ credentials/i, "")
    .replace(/\s*—\s*received securely/i, "")
    .trim();
}

function isPlaceholderWorkflow(text: string): boolean {
  return /walk through happy-path|to be confirmed|with the client/i.test(text);
}

function plainSentence(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  if (/[.!?]$/.test(trimmed)) return trimmed;
  return `${trimmed}.`;
}

function humanizeTrigger(step: string): string {
  let s = step.replace(/^\d+[.)]\s+/, "").trim();
  if (isPlaceholderWorkflow(s)) return "";

  s = s.replace(
    /^read\/export records from (.+?) \(api or scheduled export \/ rpa\)/i,
    "Starts by pulling records from $1 — via API, file export, or screen automation",
  );
  s = s.replace(
    /^trigger from the described source event/i,
    "Starts when the trigger event you described happens",
  );
  s = s.replace(/^when /i, "Starts when ");
  if (!/^starts/i.test(s)) {
    s = `Starts when ${s}`;
  }
  return plainSentence(s);
}

function humanizeAction(step: string): string {
  let s = step.replace(/^\d+[.)]\s+/, "").trim();
  if (isPlaceholderWorkflow(s)) return "";

  s = s.replace(
    /validate and normalize payload fields/i,
    "Checks the data and fixes anything missing or invalid",
  );
  s = s.replace(
    /call downstream system\(s\) with mapped data/i,
    "Sends the mapped data to the right downstream system",
  );
  s = s.replace(
    /push mapped data into (.+)/i,
    "Pushes the mapped data into $1",
  );
  s = s.replace(
    /record success \/ surface failures for review/i,
    "Logs what worked and flags anything that failed for you to review",
  );
  return plainSentence(s);
}

function toContinuationClause(text: string): string {
  const trimmed = text.replace(/\.$/, "").trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function summarizeActions(steps: string[]): string {
  const actions = steps.map(humanizeAction).filter(Boolean);
  if (actions.length === 0) return "";
  if (actions.length === 1) return actions[0]!;

  const parts = actions.map((action) =>
    toContinuationClause(action.replace(/^Starts when /i, "")),
  );
  if (parts.length === 2) {
    return plainSentence(`Then ${parts[0]}, and ${parts[1]}`);
  }
  const last = parts[parts.length - 1]!;
  const middle = parts.slice(0, -1).join(", then ");
  return plainSentence(`Then ${middle}, and finally ${last}`);
}

function formatSystemsBullet(systems: string[]): string {
  if (systems.length === 1) {
    return plainSentence(`Works with ${systems[0]}`);
  }
  if (systems.length === 2) {
    return plainSentence(`Connects ${systems[0]} and ${systems[1]}`);
  }
  const last = systems[systems.length - 1];
  const rest = systems.slice(0, -1).join(", ");
  return plainSentence(`Connects ${rest}, and ${last}`);
}

function formatOpenItemsBullet(
  openItems: Array<{ text: string; done: boolean }>,
  pendingSystems: string[],
): string {
  const parts: string[] = [];
  for (const item of openItems) {
    if (!item.done && item.text) parts.push(item.text);
  }
  if (pendingSystems.length > 0) {
    parts.push("which systems are involved");
  }
  if (parts.length === 0) return "";
  const formatted = parts.map((part, index) =>
    index === 0 ? part : toContinuationClause(part),
  );
  if (formatted.length === 1) {
    return plainSentence(`We still need: ${formatted[0]}`);
  }
  const last = formatted[formatted.length - 1]!;
  const rest = formatted.slice(0, -1).join(", ");
  return plainSentence(`We still need: ${rest}, and ${last}`);
}

/**
 * Build a brief plain-English summary of what Koda understood from the living plan.
 */
export function buildSubmitSummary(planMarkdown: string): PlanSubmitSummary {
  const goal =
    extractSection(planMarkdown, "Goal")
      ?.split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";

  const workflowSteps = parseListItems(extractSection(planMarkdown, "Workflow") ?? "");
  const allSystems = parseListItems(extractSection(planMarkdown, "Systems") ?? "");
  const systems = allSystems.filter((s) => !/^to be confirmed/i.test(s));
  const pendingSystems = allSystems.filter((s) => /^to be confirmed/i.test(s));
  const provideItems = parseProvideItems(
    extractSection(planMarkdown, "What you need to provide") ?? "",
  );

  const bullets: string[] = [];

  const firstStep = workflowSteps[0];
  const trigger = firstStep ? humanizeTrigger(firstStep) : "";
  if (trigger) {
    bullets.push(trigger);
  } else if (goal && !looksLikeQuestion(goal)) {
    bullets.push(plainSentence(goal));
  }

  if (workflowSteps.length > 1) {
    const actionBullet = summarizeActions(workflowSteps.slice(1));
    if (actionBullet) bullets.push(actionBullet);
  } else if (goal && trigger && !bullets.includes(plainSentence(goal))) {
    // Goal adds context when workflow is thin
    if (!looksLikeQuestion(goal)) bullets.push(plainSentence(goal));
  }

  if (systems.length > 0) {
    bullets.push(formatSystemsBullet(systems));
  }

  const openBullet = formatOpenItemsBullet(provideItems, pendingSystems);
  if (openBullet) bullets.push(openBullet);

  if (bullets.length === 0 && goal) {
    bullets.push(plainSentence(goal));
  }

  return { bullets: bullets.slice(0, 6) };
}

function looksLikeQuestion(text: string): boolean {
  return /^(how|what|when|where|why|which|do |does |can |is |are )/i.test(text.trim());
}

/** True when mermaid is a generic placeholder, not a useful custom diagram. */
export function isGenericMermaid(chart: string): boolean {
  const lower = chart.toLowerCase();

  if (/koda automation/.test(lower)) return true;
  if (
    /\[source\]/i.test(chart) &&
    /\[automation\]/i.test(chart) &&
    /\[destination\]/i.test(chart)
  ) {
    return true;
  }
  if (/dest\["destination"\]/i.test(chart)) return true;

  const nodeLabels = [...chart.matchAll(/\[([^\]]+)\]/g)].map((m) =>
    (m[1] ?? "").replace(/"/g, "").trim(),
  );
  if (nodeLabels.length > 0 && nodeLabels.length <= 3) {
    const generic = new Set([
      "source",
      "automation",
      "destination",
      "complete",
      "step",
      "your automation goal",
    ]);
    if (
      nodeLabels.every(
        (label) =>
          generic.has(label.toLowerCase()) ||
          label.toLowerCase() === "destination",
      )
    ) {
      return true;
    }
  }

  return false;
}

/** Return embedded mermaid only when it is a meaningful custom diagram. */
export function getMeaningfulPlanMermaid(planMarkdown: string): string | null {
  const mermaid = extractMermaidFromMarkdown(planMarkdown);
  if (!mermaid || isGenericMermaid(mermaid)) return null;
  return mermaid;
}
