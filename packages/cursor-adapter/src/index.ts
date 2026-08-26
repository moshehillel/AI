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
    throw new Error("CURSOR_API_KEY is not configured");
  }
  return key;
}

/**
 * Thin adapter over @cursor/sdk so API beta churn stays isolated.
 * Uses dynamic import so the platform can boot without the SDK in local mock mode.
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
    run: mapStream(run.stream()),
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
    run: mapStream(run.stream()),
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

async function* mapStream(
  stream: AsyncIterable<{ type: string; [key: string]: unknown }>,
): AsyncGenerator<NormalizedStreamEvent> {
  for await (const event of stream) {
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
          ? "Proposed plan:\n1. Locate relevant modules\n2. Implement change\n3. Add tests"
          : "Implemented the requested change on the feature branch (mock).",
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
      yield { type: "status" as const, message: "Continuing (mock)…" };
      yield {
        type: "assistant" as const,
        text: "Updated the change based on your follow-up (mock).",
      };
      yield { type: "done" as const };
    })(),
    wait: async (): Promise<AgentRunResult> => ({
      agentId: input.agentId,
      text: "Updated the change based on your follow-up (mock).",
      usage: { inputTokens: 50, outputTokens: 80, totalTokens: 130 },
    }),
  };
}

async function* mockStream(
  input: CreateTaskAgentInput,
): AsyncGenerator<NormalizedStreamEvent> {
  yield { type: "status", message: "Analyzing project…" };
  yield { type: "assistant", text: "I found the relevant application logic." };
  if (input.mode === "plan") {
    yield {
      type: "assistant",
      text: "This is a larger change. I've prepared a plan for your review.",
    };
  } else {
    yield { type: "status", message: "Making the change…" };
    yield { type: "assistant", text: "Code updated on the feature branch." };
  }
  yield { type: "usage", inputTokens: 100, outputTokens: 200, totalTokens: 300 };
  yield { type: "done" };
}
