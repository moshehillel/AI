declare module "@cursor/sdk" {
  export type ModelSelection = { id: string; params?: Array<{ id: string; value: string }> };

  export type TokenUsage = {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
  };

  export type RunResult = {
    result?: string;
    model?: ModelSelection;
    usage?: TokenUsage;
    git?: { branches?: Array<{ repoUrl: string; branch?: string; prUrl?: string }> };
  };

  export type RunHandle = {
    id?: string;
    stream: () => AsyncIterable<{ type: string; [key: string]: unknown }>;
    wait: () => Promise<RunResult>;
  };

  export type SDKAgent = {
    agentId: string;
    send: (
      prompt: string,
      options?: { mode?: "plan" | "agent"; model?: ModelSelection },
    ) => Promise<RunHandle>;
    getUsage: () => Promise<unknown>;
  };

  export const Agent: {
    create: (options: Record<string, unknown>) => Promise<SDKAgent>;
    resume: (agentId: string, options?: Record<string, unknown>) => Promise<SDKAgent>;
  };
}

export {};
