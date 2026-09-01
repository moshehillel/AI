export type AgentMode = "plan" | "agent";

/** Cursor Cloud Agents / SDK only accept raster images on send (not PDF/xlsx). */
export type AgentImageAttachment = {
  data: string;
  mimeType: string;
};

export type CreateTaskAgentInput = {
  repoUrl: string;
  branch: string;
  prompt: string;
  mode: AgentMode;
  metadata?: Record<string, string>;
  modelId?: string;
  images?: AgentImageAttachment[];
};

export type FollowUpInput = {
  agentId: string;
  prompt: string;
  mode?: AgentMode;
  images?: AgentImageAttachment[];
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

/** Dashboard URL for an agent (developer-facing only). */
export function agentWebUrl(agentId: string): string {
  return `https://cursor.com/agents/${agentId}`;
}

/** Deep link that opens / resumes the agent in the Cursor app. */
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

export type AgentSessionHandle = {
  agentId: string;
  /** Available immediately so cancel can target the run before wait() finishes. */
  runId?: string;
  run: AsyncIterable<NormalizedStreamEvent>;
  wait: () => Promise<AgentRunResult>;
};

export async function createTaskAgent(
  input: CreateTaskAgentInput,
): Promise<AgentSessionHandle> {
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

  const message = buildSendMessage(input.prompt, input.images);
  const imageCount = input.images?.length ?? 0;
  if (imageCount > 0) {
    console.info(
      `[cursor-adapter] createTaskAgent attaching ${imageCount} image(s) for layout`,
    );
  }
  const run = await agent.send(message);
  const streamed = { assistantText: "" };

  return {
    agentId: agent.agentId,
    runId: run.id,
    run: mapStream(
      run.stream() as AsyncIterable<{ type: string } & Record<string, unknown>>,
      streamed,
    ),
    wait: async () => {
      const result = await run.wait();
      const branchInfo = result.git?.branches?.[0];
      const text = await resolveRunTextWithFallbacks(
        run,
        result.result,
        streamed.assistantText,
      );
      return {
        agentId: agent.agentId,
        runId: run.id,
        text,
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
): Promise<AgentSessionHandle> {
  const sdk = await loadCursorSdk();
  if (isMockMode(sdk)) {
    console.warn(
      `[cursor-adapter] MOCK resumeAndSend mode=${input.mode ?? "agent"} agentId=${input.agentId}`,
    );
    return mockFollowUp(input);
  }

  const imageCount = input.images?.length ?? 0;
  console.info(
    `[cursor-adapter] LIVE resumeAndSend mode=${input.mode ?? "agent"} agentId=${input.agentId} images=${imageCount}`,
  );

  const { Agent } = sdk!;
  const agent = await Agent.resume(input.agentId, {
    apiKey: requireApiKey(),
  });

  const message = buildSendMessage(input.prompt, input.images);
  const run = await agent.send(message, {
    mode: input.mode,
  });
  const streamed = { assistantText: "" };

  return {
    agentId: agent.agentId,
    runId: run.id,
    run: mapStream(
      run.stream() as AsyncIterable<{ type: string } & Record<string, unknown>>,
      streamed,
    ),
    wait: async () => {
      const result = await run.wait();
      const text = await resolveRunTextWithFallbacks(
        run,
        result.result,
        streamed.assistantText,
      );
      return {
        agentId: agent.agentId,
        runId: run.id,
        text,
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

function buildSendMessage(
  prompt: string,
  images?: AgentImageAttachment[],
): string | { text: string; images: Array<{ data: string; mimeType: string }> } {
  const cleaned = (images ?? [])
    .filter((img) => img.data && img.mimeType)
    .slice(0, 5)
    .map((img) => ({
      data: img.data,
      mimeType: img.mimeType,
    }));
  if (!cleaned.length) return prompt;
  return { text: prompt, images: cleaned };
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

type StreamAccumulator = { assistantText: string };

async function* mapStream(
  stream: AsyncIterable<{ type: string } & Record<string, unknown>>,
  accumulator?: StreamAccumulator,
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
      if (text) {
        if (accumulator) accumulator.assistantText += text;
        yield { type: "assistant", text };
      }
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

/** Prefer wait() result, then run handle, then streamed assistant chunks. */
function resolveRunText(
  waitResult: string | null | undefined,
  runHandle: { result?: string | null },
  streamed: string,
): string | undefined {
  const fromWait = waitResult?.trim();
  if (fromWait) return fromWait;
  const fromHandle = runHandle.result?.trim();
  if (fromHandle) return fromHandle;
  const fromStream = streamed.trim();
  if (fromStream) return fromStream;
  return undefined;
}

/** Last assistant prose from SDK conversation turns (when result.result is empty). */
function extractLatestAssistantText(
  turns: Array<{
    type?: string;
    turn?: {
      steps?: Array<{
        type?: string;
        message?: { text?: string };
      }>;
    };
  }>,
): string | undefined {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    const steps =
      turn?.type === "agentConversationTurn" ? turn.turn?.steps : undefined;
    if (!steps?.length) continue;
    for (let j = steps.length - 1; j >= 0; j -= 1) {
      const step = steps[j];
      if (step?.type === "assistantMessage") {
        const text = step.message?.text?.trim();
        if (text) return text;
      }
    }
  }
  return undefined;
}

async function resolveRunTextWithFallbacks(
  run: {
    result?: string | null;
    supports: (operation: "stream" | "wait" | "cancel" | "conversation") => boolean;
    conversation: () => Promise<unknown[]>;
  },
  waitResult: string | null | undefined,
  streamed: string,
): Promise<string | undefined> {
  let text = resolveRunText(waitResult, run, streamed);
  if (!text && run.supports("conversation")) {
    try {
      const turns = (await run.conversation()) as Parameters<
        typeof extractLatestAssistantText
      >[0];
      text = extractLatestAssistantText(turns);
      if (text) {
        console.info("[cursor-adapter] used conversation() fallback for reply text");
      }
    } catch (error) {
      console.warn("[cursor-adapter] conversation fallback failed", error);
    }
  }
  return text;
}

function mockPlanReply(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (/what('?s| is) your name|who are you/.test(lower)) {
    return [
      "I'm **Koda** — Advanced Automations' AI Builder.",
      "",
      "I help you plan automations in plain language. The full plan lives in the Plan panel.",
      "",
      "**Quick question:** What would you like to automate?",
    ].join("\n");
  }
  if (
    /\b(show (me )?(the )?(current )?plan|plan summary|status summary|where are we|what('?s| is) the plan)\b/.test(
      lower,
    )
  ) {
    return [
      "Here's where the plan stands — full detail is in the **Plan panel**.",
      "",
      "Review **What you need to provide** there for the open checklist.",
      "",
      "```plan",
      "# Plan",
      "## Goal",
      "Automate the workflow described in chat.",
      "## What you need to provide",
      "- [ ] Logins or sample files needed for this automation (to be confirmed)",
      "```",
    ].join("\n");
  }
  if (
    /(how (will|do|can|would).*(pull|get|fetch).*(hha|provider)|rpa|api.*(hha|provider))/i.test(
      lower,
    )
  ) {
    return [
      "Here's the simple order I'd use to move data between Provider Soft and HHA:",
      "",
      "1. **Official connection or file export** — if either system can share data securely or save files on a schedule, we use that first.",
      "2. **Screen automation** — only if there is no better option. A bot logs into the website and clicks through screens.",
      "",
      "I've updated the Plan panel with this approach.",
      "",
      "1. Today, do staff only log into these systems in a browser, or do you already get file exports?",
      "2. Which direction should data flow first — Provider Soft → HHA, HHA → Provider Soft, or both?",
      "",
      "```plan",
      "# Plan: Provider Soft ↔ HHA",
      "## Goal",
      "Connect Provider Soft and HHA so records sync reliably.",
      "## Systems",
      "- Provider Soft",
      "- HHA / HHAeXchange",
      "## Integrations / APIs",
      "- Prefer secure data connection or scheduled file export; screen automation only if needed",
      "## Workflow",
      "1. Read records from the source system",
      "2. Check and match fields",
      "3. Send to the destination system",
      "4. Show errors clearly when something fails",
      "## What you need to provide",
      "- [ ] Provider Soft login — use Add secrets / credentials",
      "- [ ] HHA / HHAeXchange login — use Add secrets / credentials",
      "```",
    ].join("\n");
  }
  if (/(diagram|digram|mermaid|flowchart)/.test(lower)) {
    return [
      "Here's a simple diagram of the flow based on your brief:",
      "",
      "```mermaid",
      "flowchart LR",
      "  A[Trigger] --> B[Automation]",
      "  B --> C[Destination]",
      "```",
      "",
      "**Quick question:** Does this match how work moves in your office today?",
      "",
      "```plan",
      "# Plan (draft)",
      "## Goal",
      "Automate the workflow described in chat.",
      "## Workflow",
      "1. Something starts the work",
      "2. Data is checked and prepared",
      "3. Result is sent to the right place",
      "```",
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

  const goal =
    goalCandidate?.slice(0, 400).replace(/\n+/g, " ").trim() ||
    (systems.length >= 2
      ? `Connect ${systems.join(" and ")} so data flows reliably.`
      : "Confirm outcome with the client.");

  return [
    "Thanks — I've updated the living plan in the Plan panel based on what you shared.",
    "",
    systems.length
      ? "**Quick question:** Does this capture what you want, or should we change anything?"
      : "1. What systems are involved, and what should happen step by step?",
    "",
    "```plan",
    "# Plan",
    "## Goal",
    goal,
    "## Systems",
    ...(systems.length ? systems.map((s) => `- ${s}`) : ["- To be confirmed"]),
    "## Workflow",
    "1. Something triggers the work",
    "2. Data is checked and prepared",
    "3. Result goes to the right system",
    "4. Errors are shown clearly",
    "## What you need to provide",
    "- [ ] Logins or sample files needed for this automation (to be confirmed)",
    "```",
  ].join("\n");
}

function mockCreate(input: CreateTaskAgentInput) {
  const agentId = `bc-mock-${Date.now()}`;
  const runId = `run-mock-${Date.now()}`;
  const text =
    input.mode === "plan"
      ? mockPlanReply(input.prompt)
      : "Built the requested automation on an isolated preview (mock).";
  return {
    agentId,
    runId,
    run: mockStream(input, text),
    wait: async (): Promise<AgentRunResult> => ({
      agentId,
      runId,
      text,
      model: "mock-auto",
      branch: input.branch,
      usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
    }),
  };
}

function mockFollowUp(input: FollowUpInput) {
  const runId = `run-mock-fu-${Date.now()}`;
  const text =
    input.mode === "plan"
      ? mockPlanReply(input.prompt)
      : "Updated the program based on your follow-up.";
  return {
    agentId: input.agentId,
    runId,
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
      runId,
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
