/**
 * Developer build / Test & Improve workspace metadata on ChangeRequest.buildSetup.
 * Staff-only — never render vendor names to customers.
 */
export type ProgramBuildSetup = {
  serverLabel?: string;
  autoDeploy?: boolean;
  notes?: string | null;
  startedAt?: string;
  startedBy?: string;
  testImproveGranted?: boolean;
  testImproveGrantedAt?: string;
  testImproveGrantedBy?: string;
  planAgentId?: string | null;
  buildAgentId?: string | null;
  openInWebUrl?: string | null;
  openInCursorUrl?: string | null;
  lastOpenedInCursorAt?: string | null;
};

export function parseBuildSetup(raw: unknown): ProgramBuildSetup {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as ProgramBuildSetup;
}

export function developerPlanReviewPrompt(input: {
  title: string;
  planMarkdown: string;
  description?: string;
}): string {
  return [
    "You are helping a developer review a customer-approved automation plan.",
    "Stay in PLAN mode: refine and clarify the plan; do not implement code until the developer switches to Build / agent mode.",
    "Never mention underlying vendors or internal tooling by name in replies that may sync back to the customer product.",
    "",
    `Program title: ${input.title}`,
    input.description?.trim()
      ? `Original brief:\n${input.description.trim()}`
      : "",
    "",
    "# Customer plan (source of truth)",
    input.planMarkdown.trim() ||
      "(No plan markdown yet — ask the developer what to build.)",
    "",
    "Present the plan clearly. Wait for the developer to click Build / switch to agent mode before implementing.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function developerBuildPrompt(input: {
  title: string;
  planMarkdown: string;
  serverLabel?: string;
}): string {
  return [
    "Switch to BUILD / agent mode. Implement the approved program plan on the isolated branch.",
    "Edit code, run tests, and prepare a deployable preview. Keep customer-facing messages free of vendor names.",
    input.serverLabel ? `Target environment label: ${input.serverLabel}` : "",
    "",
    `Program title: ${input.title}`,
    "",
    "# Approved plan",
    input.planMarkdown.trim() || input.title,
  ]
    .filter(Boolean)
    .join("\n");
}

export function developerTestImprovePrompt(input: {
  title: string;
  planMarkdown: string;
}): string {
  return [
    "Test & Improve workspace is now open for this program.",
    "You have access to the code: edit, fix, improve tests, and prepare deploy.",
    "Iterate until the preview is ready for the customer to verify in Koda.",
    "",
    `Program: ${input.title}`,
    "",
    "# Plan",
    input.planMarkdown.trim() || input.title,
  ].join("\n");
}
