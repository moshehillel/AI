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

export async function createTaskAgent(
  input: CreateTaskAgentInput,
): Promise<{ agentId: string; run: AsyncIterable<NormalizedStreamEvent>; wait: () => Promise<AgentRunResult> }> {
  const sdk = await loadCursorSdk();
  if (process.env.CURSOR_MOCK === "1" || !process.env.CURSOR_API_KEY || !sdk) {
    return mockCreate(input);
  }

  const { Agent } = sdk;
  const agent = await Agent.create({
    apiKey: requireApiKey(),
    model: { id: input.modelId ?? "auto-smart" },
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
  if (process.env.CURSOR_MOCK === "1" || !process.env.CURSOR_API_KEY || !sdk) {
    return mockFollowUp(input);
  }

  const { Agent } = sdk;
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

function mockCreate(input: CreateTaskAgentInput) {
  const agentId = `bc-mock-${Date.now()}`;
  return {
    agentId,
    run: mockStream(input),
    wait: async (): Promise<AgentRunResult> => ({
      agentId,
      runId: `run-mock-${Date.now()}`,
      text:
        input.mode === "plan"
          ? "Proposed plan:\n1. Map the workflow and integrations\n2. Design the automation steps\n3. Define acceptance tests"
          : "Built the requested automation on an isolated preview (mock).",
      model: "mock-auto",
      branch: input.branch,
      usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
    }),
  };
}

function mockFollowUp(input: FollowUpInput) {
  return {
    agentId: input.agentId,
    run: (async function* () {
      yield { type: "status" as const, message: "Continuing with Koda…" };
      yield {
        type: "assistant" as const,
        text: "Updated the program based on your follow-up.",
      };
      yield { type: "done" as const };
    })(),
    wait: async (): Promise<AgentRunResult> => ({
      agentId: input.agentId,
      text: "Updated the program based on your follow-up.",
      usage: { inputTokens: 50, outputTokens: 80, totalTokens: 130 },
    }),
  };
}

async function* mockStream(
  input: CreateTaskAgentInput,
): AsyncGenerator<NormalizedStreamEvent> {
  yield { type: "status", message: "Reviewing your inputs…" };
  yield {
    type: "assistant",
    text: "I reviewed the workflow details you shared.",
  };
  if (input.mode === "plan") {
    yield {
      type: "assistant",
      text: "I've prepared a plan. Ask questions or submit to a developer when you're ready.",
    };
  } else {
    yield { type: "status", message: "Building your program…" };
    yield { type: "assistant", text: "Preview build updated." };
  }
  yield { type: "usage", inputTokens: 100, outputTokens: 200, totalTokens: 300 };
  yield { type: "done" };
}
