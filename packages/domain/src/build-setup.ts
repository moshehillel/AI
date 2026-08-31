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
  verifyPhaseOpenedAt?: string | null;
  verifyPhaseOpenedBy?: string | null;
};

export function parseBuildSetup(raw: unknown): ProgramBuildSetup {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as ProgramBuildSetup;
}

function secretKeysSection(secretKeyNames?: string[]): string {
  const keys = (secretKeyNames ?? []).filter(Boolean);
  if (keys.length === 0) {
    return [
      "# Customer secrets",
      "None stored yet. Check Build desk in Koda for Reveal / copy-once when the customer adds credentials.",
      "Never invent credentials. Never put secret values into commits, PR bodies, or customer-facing chat.",
    ].join("\n");
  }
  return [
    "# Customer secrets (names only — values are NOT included here)",
    "Decrypt / copy values only from the staff Build desk in Koda (Reveal / copy-once).",
    "Never log secret values, never commit them to git, and never paste them into PR bodies.",
    ...keys.map((k) => `- ${k}`),
  ].join("\n");
}

export function developerPlanReviewPrompt(input: {
  title: string;
  planMarkdown: string;
  description?: string;
  secretKeyNames?: string[];
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
    secretKeysSection(input.secretKeyNames),
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
  secretKeyNames?: string[];
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
    "",
    secretKeysSection(input.secretKeyNames),
  ]
    .filter(Boolean)
    .join("\n");
}

export function developerTestImprovePrompt(input: {
  title: string;
  planMarkdown: string;
  secretKeyNames?: string[];
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
    "",
    secretKeysSection(input.secretKeyNames),
  ].join("\n");
}

/** When developer marks the build ready for customer testing. */
export function developerReadyForClientTestingPrompt(input: {
  title: string;
  planMarkdown: string;
  previewUrl?: string | null;
}): string {
  return [
    "The customer verification phase is now open in Koda.",
    "They can ask how things work, request test scripts, and describe changes in plain English.",
    "Implement requested edits on the branch. Do not mention vendors or internal tooling in customer-facing replies.",
    input.previewUrl ? `Preview URL for testing: ${input.previewUrl}` : "",
    "",
    `Program: ${input.title}`,
    "",
    "# Approved plan",
    input.planMarkdown.trim() || input.title,
    "",
    "Keep the preview working. When the customer is satisfied they will submit for final review.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Customer messages during Test & request changes (agent/build mode). */
export function clientVerifyAgentInstructions(): string {
  return [
    "You are Koda helping a customer test their new automation and request changes.",
    "Planning is closed — do not rewrite the plan. Focus on how the build works, testing steps, and implementing requested edits on the code branch.",
    "Speak in plain English. Never mention GitHub, Cursor, Railway, or other vendor names.",
    "When they describe a change, implement it on the branch and explain what you changed in simple terms.",
    "If they ask how to test, give concrete steps they can follow without exposing infrastructure details.",
  ].join("\n");
}

export function clientVerifyFollowUpPrompt(input: {
  title: string;
  planMarkdown: string;
  customerMessage: string;
  previewUrl?: string | null;
}): string {
  return [
    clientVerifyAgentInstructions(),
    "",
    `Program: ${input.title}`,
    input.previewUrl ? `Preview: ${input.previewUrl}` : "",
    "",
    "# Plan (reference only — do not reopen planning)",
    input.planMarkdown.trim() || input.title,
    "",
    "# Customer message",
    input.customerMessage.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Dashboard URL for an agent (developer-facing only). */
export function agentWebUrl(agentId: string): string {
  return `https://cursor.com/agents/${agentId}`;
}

export function agentCursorDeepLink(agentId: string): string {
  return `https://cursor.com/background-agent?bcId=${encodeURIComponent(agentId)}`;
}

export function agentOpenUrls(agentId: string): {
  agentId: string;
  openInWebUrl: string;
  openInCursorUrl: string;
} {
  return {
    agentId,
    openInWebUrl: agentWebUrl(agentId),
    openInCursorUrl: agentCursorDeepLink(agentId),
  };
}
