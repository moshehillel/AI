export type AgentMode = "plan" | "agent";

export type CreateTaskAgentInput = {
  repoUrl: string;
  branch: string;
  prompt: string;
  mode: AgentMode;
  metadata?: Record<string, string>;
  modelId?: string;
};

export type FollowUpInput = {
  agentId: string;
  prompt: string;
  mode?: AgentMode;
};

export type NormalizedStreamEvent =
  | { type: "assistant"; text: string }
  | { type: "status"; message: string }
  | { type: "thinking"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; totalTokens: number }
  | { type: "done"; summary?: string };

export type AgentRunResult = {
  agentId: string;
  runId?: string;
  text?: string;
  model?: string;
  branch?: string;
  prUrl?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

function requireApiKey(): string {
  const key = process.env.CURSOR_API_KEY;
  if (!key) {
    throw new Error("AI backend API key is not configured");
  }
  return key;
}

/**
 * Thin adapter over the AI build backend SDK.
 * Uses dynamic import so the platform can boot without the SDK in local mock mode.
 * Customer-facing product name is Koda — do not surface backend vendor names in UI.
 */
async function loadCursorSdk(): Promise<typeof import("@cursor/sdk") | null> {
  try {
    return await import("@cursor/sdk");
  } catch {
    return null;
  }
}

function isMockMode(sdk: typeof import("@cursor/sdk") | null): boolean {
  return process.env.CURSOR_MOCK === "1" || !process.env.CURSOR_API_KEY || !sdk;
}

/**
 * Pick a model id the account actually has. `auto-smart` is not always available
 * (Router may be off); this account exposes `default` (Auto) instead.
 */
async function resolveModelSelection(
  sdk: typeof import("@cursor/sdk"),
  preferred?: string,
): Promise<{ id: string }> {
  const requested =
    preferred?.trim() ||
    process.env.CURSOR_MODEL_ID?.trim() ||
    "";
  try {
    const models = await sdk.Cursor.models.list({ apiKey: requireApiKey() });
    const ids = models.map((m) => m.id);
    if (requested && ids.includes(requested)) {
      return { id: requested };
    }
    for (const candidate of ["default", "auto", "composer-2", "composer-2.5"]) {
      if (ids.includes(candidate)) return { id: candidate };
    }
    if (ids[0]) return { id: ids[0] };
  } catch (error) {
    console.warn("[cursor-adapter] models.list failed; falling back", error);
  }
  return { id: requested || "default" };
}

export async function createTaskAgent(
  input: CreateTaskAgentInput,
): Promise<{ agentId: string; run: AsyncIterable<NormalizedStreamEvent>; wait: () => Promise<AgentRunResult> }> {
  const sdk = await loadCursorSdk();
  if (isMockMode(sdk)) {
    console.warn(
      `[cursor-adapter] MOCK createTaskAgent mode=${input.mode} (CURSOR_MOCK=${process.env.CURSOR_MOCK ?? "unset"} sdk=${Boolean(sdk)} key=${Boolean(process.env.CURSOR_API_KEY)})`,
    );
    return mockCreate(input);
  }

  const model = await resolveModelSelection(sdk!, input.modelId);
  console.info(
    `[cursor-adapter] LIVE createTaskAgent mode=${input.mode} model=${model.id} repo=${input.repoUrl} branch=${input.branch}`,
  );

  const { Agent } = sdk!;
  const agent = await Agent.create({
    apiKey: requireApiKey(),
    model,
    mode: input.mode,
    cloud: {
      repos: [{ url: input.repoUrl, startingRef: input.branch }],
      workOnCurrentBranch: true,
      autoCreatePR: false,
      metadata: input.metadata,
    },
  });

  const run = await agent.send(input.prompt);

  return {
    agentId: agent.agentId,
    run: mapStream(run.stream() as AsyncIterable<{ type: string } & Record<string, unknown>>),
    wait: async () => {
      const result = await run.wait();
      const branchInfo = result.git?.branches?.[0];
      return {
        agentId: agent.agentId,
        runId: run.id,
        text: result.result,
        model: result.model?.id,
        branch: branchInfo?.branch,
        prUrl: branchInfo?.prUrl,
        usage: result.usage
          ? {
              inputTokens: result.usage.inputTokens ?? 0,
              outputTokens: result.usage.outputTokens ?? 0,
              totalTokens: result.usage.totalTokens ?? 0,
            }
          : undefined,
      };
    },
  };
}

export async function resumeAndSend(
  input: FollowUpInput,
): Promise<{ agentId: string; run: AsyncIterable<NormalizedStreamEvent>; wait: () => Promise<AgentRunResult> }> {
  const sdk = await loadCursorSdk();
  if (isMockMode(sdk)) {
    console.warn(
      `[cursor-adapter] MOCK resumeAndSend mode=${input.mode ?? "agent"} agentId=${input.agentId}`,
    );
    return mockFollowUp(input);
  }

  console.info(
    `[cursor-adapter] LIVE resumeAndSend mode=${input.mode ?? "agent"} agentId=${input.agentId}`,
  );

  const { Agent } = sdk!;
  const agent = await Agent.resume(input.agentId, {
    apiKey: requireApiKey(),
  });

  const run = await agent.send(input.prompt, {
    mode: input.mode,
  });

  return {
    agentId: agent.agentId,
    run: mapStream(run.stream() as AsyncIterable<{ type: string } & Record<string, unknown>>),
    wait: async () => {
      const result = await run.wait();
      return {
        agentId: agent.agentId,
        runId: run.id,
        text: result.result,
        model: result.model?.id,
        usage: result.usage
          ? {
              inputTokens: result.usage.inputTokens ?? 0,
              outputTokens: result.usage.outputTokens ?? 0,
              totalTokens: result.usage.totalTokens ?? 0,
            }
          : undefined,
      };
    },
  };
}

export async function getAgentUsage(agentId: string) {
  const sdk = await loadCursorSdk();
  if (process.env.CURSOR_MOCK === "1" || !process.env.CURSOR_API_KEY || !sdk) {
    return { totalCents: 0, agentId };
  }
  const { Agent } = sdk;
  const agent = await Agent.resume(agentId, { apiKey: requireApiKey() });
  const usage = await agent.getUsage();
  return usage;
}

export async function cancelAgentRun(input: {
  agentId: string;
  runId?: string | null;
}) {
  const sdk = await loadCursorSdk();
  if (process.env.CURSOR_MOCK === "1" || !process.env.CURSOR_API_KEY || !sdk) {
    return { cancelled: true, mock: true as const };
  }

  // Prefer SDK cancel when available; fall back to Cloud Agents API v1.
  try {
    const agent = await sdk.Agent.resume(input.agentId, {
      apiKey: requireApiKey(),
    });
    const maybeCancel = (
      agent as unknown as {
        cancel?: () => Promise<unknown>;
      }
    ).cancel;
    if (typeof maybeCancel === "function") {
      await maybeCancel.call(agent);
      return { cancelled: true };
    }
  } catch {
    // continue to REST fallback
  }

  if (!input.runId) {
    return { cancelled: false, reason: "No run id available to cancel" };
  }

  const response = await fetch(
    `https://api.cursor.com/v1/agents/${input.agentId}/runs/${input.runId}/cancel`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireApiKey()}`,
        "Content-Type": "application/json",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`AI cancel failed: HTTP ${response.status}`);
  }
  return { cancelled: true };
}

async function* mapStream(
  stream: AsyncIterable<{ type: string } & Record<string, unknown>>,
): AsyncGenerator<NormalizedStreamEvent> {
  for await (const event of stream as AsyncIterable<{
    type: string;
    message?: { content?: Array<{ type: string; text?: string }> };
    text?: string;
    status?: string;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  }>) {
    if (event.type === "assistant") {
      const message = event.message as { content?: Array<{ type: string; text?: string }> } | undefined;
      const text = message?.content?.map((c) => c.text ?? "").join("") ?? "";
      if (text) yield { type: "assistant", text };
    } else if (event.type === "status") {
      yield {
        type: "status",
        message: String(event.message ?? event.status ?? "Working…"),
      };
    } else if (event.type === "thinking") {
      yield { type: "thinking", text: String(event.text ?? "") };
    } else if (event.type === "usage") {
      const usage = event.usage as {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
      yield {
        type: "usage",
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
      };
    }
  }
  yield { type: "done" };
}

function mockPlanReply(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (/what('?s| is) your name|who are you/.test(lower)) {
    return [
      "I'm **Koda** — Advanced Automations' AI Builder.",
      "",
      "Tell me what you want to automate and I'll draft a living plan (with diagrams when you ask).",
      "",
      "Koda is AI and can make mistakes.",
    ].join("\n");
  }
  if (
    /(how (will|do|can|would).*(pull|get|fetch).*(hha|provider)|rpa|api.*(hha|provider))/i.test(
      lower,
    )
  ) {
    return [
      "For HHA / Provider Soft I'd prefer an official API or scheduled export first; RPA only if neither exists.",
      "",
      "# Plan",
      "## Goal",
      "Connect Provider Soft and HHA so records sync reliably.",
      "",
      "## Systems",
      "- Provider Soft",
      "- HHA / HHAeXchange",
      "",
      "## Integrations / APIs",
      "- API/export first; RPA fallback for UI-only workflows",
      "",
      "## Workflow",
      "1. Read from source (API, export, or RPA)",
      "2. Validate and map fields",
      "3. Write to destination",
      "4. Surface failures / duplicates",
      "",
      "Koda is AI and can make mistakes.",
    ].join("\n");
  }
  if (/(diagram|digram|mermaid|flowchart)/.test(lower)) {
    return [
      "Here's a diagram of the flow based on your brief:",
      "",
      "```mermaid",
      "flowchart LR",
      "  A[Trigger] --> B[Automation]",
      "  B --> C[Destination]",
      "```",
      "",
      "# Plan (draft)",
      "## Goal",
      "Automate the workflow described in chat.",
      "## Workflow",
      "1. Receive trigger",
      "2. Transform / validate",
      "3. Write to destination",
      "",
      "Koda is AI and can make mistakes.",
    ].join("\n");
  }

  const systems: string[] = [];
  if (/quickbooks?|\bqb\b/.test(lower)) systems.push("QuickBooks");
  if (/gmail|email|invoice/.test(lower)) systems.push("Email");
  if (/slack/.test(lower)) systems.push("Slack");
  if (/\bhha\b|hhax|home\s*health/.test(lower)) systems.push("HHA / HHAeXchange");
  if (/provider\s*soft|providersoft/.test(lower)) systems.push("Provider Soft");

  const goalCandidate = prompt
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .find(
      (l) =>
        !/^(you are koda|program title|initial brief|client message|conversation so far|respond as koda)/i.test(
          l,
        ) &&
        !l.endsWith("?") &&
        l.length > 24,
    );

  return [
    "Here's a draft plan from what you shared:",
    "",
    "# Plan",
    "## Goal",
    goalCandidate?.slice(0, 400).replace(/\n+/g, " ").trim() ||
      (systems.length >= 2
        ? `Connect ${systems.join(" and ")} so data flows reliably.`
        : "Confirm outcome with the client."),
    "",
    "## Systems",
    ...(systems.length ? systems.map((s) => `- ${s}`) : ["- To be confirmed"]),
    "",
    "## Workflow",
    "1. Trigger from the source event",
    "2. Validate and map fields",
    "3. Call the destination system",
    "4. Handle errors / notify as needed",
    "",
    "## Edge cases",
    "- Missing fields, API errors, duplicates",
    "",
    "## Acceptance criteria",
    "- Happy path works in a test environment",
    "- Failures are visible",
    "",
    systems.length
      ? "Ask me to refine any section, or request a diagram."
      : "What systems are involved, and what should happen step by step?",
    "",
    "Koda is AI and can make mistakes.",
  ].join("\n");
}

function mockCreate(input: CreateTaskAgentInput) {
  const agentId = `bc-mock-${Date.now()}`;
  const text =
    input.mode === "plan"
      ? mockPlanReply(input.prompt)
      : "Built the requested automation on an isolated preview (mock).";
  return {
    agentId,
    run: mockStream(input, text),
    wait: async (): Promise<AgentRunResult> => ({
      agentId,
      runId: `run-mock-${Date.now()}`,
      text,
      model: "mock-auto",
      branch: input.branch,
      usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
    }),
  };
}

function mockFollowUp(input: FollowUpInput) {
  const text =
    input.mode === "plan"
      ? mockPlanReply(input.prompt)
      : "Updated the program based on your follow-up.";
  return {
    agentId: input.agentId,
    run: (async function* () {
      yield { type: "status" as const, message: "Continuing with Koda…" };
      yield {
        type: "assistant" as const,
        text,
      };
      yield { type: "done" as const };
    })(),
    wait: async (): Promise<AgentRunResult> => ({
      agentId: input.agentId,
      text,
      usage: { inputTokens: 50, outputTokens: 80, totalTokens: 130 },
    }),
  };
}

async function* mockStream(
  input: CreateTaskAgentInput,
  text: string,
): AsyncGenerator<NormalizedStreamEvent> {
  yield { type: "status", message: "Reviewing your inputs…" };
  yield { type: "assistant", text };
  if (input.mode !== "plan") {
    yield { type: "status", message: "Building your program…" };
  }
  yield { type: "usage", inputTokens: 100, outputTokens: 200, totalTokens: 300 };
  yield { type: "done" };
}
