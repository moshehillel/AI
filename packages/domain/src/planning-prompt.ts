/** Max chars sent to the Cursor agent in one turn (full text stays in chat). */
export const PLANNING_AGENT_PROMPT_MAX = 6000;

const LONG_NOTE_HEAD =
  "[Long note — condensed for the agent; your full message is saved in chat history]\n\n";

/**
 * Condense very long user pastes before sending to Cursor to reduce empty replies
 * and timeouts. Preserves the start and end of the message.
 */
export function preparePlanningUserPrompt(text: string): {
  prompt: string;
  wasLong: boolean;
  originalLength: number;
} {
  const trimmed = text.trim();
  const originalLength = trimmed.length;
  if (originalLength <= PLANNING_AGENT_PROMPT_MAX) {
    return { prompt: trimmed, wasLong: false, originalLength };
  }

  const headBudget = Math.floor(PLANNING_AGENT_PROMPT_MAX * 0.65);
  const tailBudget = Math.floor(PLANNING_AGENT_PROMPT_MAX * 0.25);
  const omitted = originalLength - headBudget - tailBudget;
  const head = trimmed.slice(0, headBudget).trimEnd();
  const tail = trimmed.slice(-tailBudget).trimStart();

  const prompt = [
    LONG_NOTE_HEAD,
    head,
    "",
    `[… ${omitted.toLocaleString()} characters omitted from the middle — refer to chat history for the full note …]`,
    "",
    tail,
  ].join("\n");

  return { prompt, wasLong: true, originalLength };
}

export type EmptyReplyRecoveryPath =
  | "wait_result"
  | "run_handle"
  | "stream"
  | "live_draft"
  | "conversation"
  | "retry_succeeded"
  | "none";

/** Pick which source supplied assistant text (for debug logging, no secrets). */
export function classifyEmptyReplyRecovery(opts: {
  waitText?: string | null;
  handleText?: string | null;
  streamedText?: string | null;
  liveDraft?: string | null;
  conversationText?: string | null;
}): EmptyReplyRecoveryPath {
  if (opts.waitText?.trim()) return "wait_result";
  if (opts.handleText?.trim()) return "run_handle";
  if (opts.streamedText?.trim()) return "stream";
  if (opts.liveDraft?.trim()) return "live_draft";
  if (opts.conversationText?.trim()) return "conversation";
  return "none";
}
