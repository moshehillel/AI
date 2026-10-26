/**
 * Connected-repo chat: the assigned user can change the linked GitHub project,
 * including a full restructure. A push happens only when they ask, and each
 * ask is its own commit so it can be reverted on GitHub.
 */

export type QueuedAgentTurn = {
  prompt: string;
  attachmentRefs?: string[];
  userMessageId?: string;
  mode?: "plan" | "agent";
  pushRequest?: boolean;
};

/** Shown when Cursor never returns a reply. */
export const CURSOR_NO_RESPONSE_MESSAGE =
  "Koda didn't respond. The agent call timed out before a reply arrived.";

/** Shown when Cursor finishes with no text. */
export const CURSOR_EMPTY_RESPONSE_MESSAGE =
  "Koda didn't respond. The agent finished without a reply.";

/**
 * Chat text for a failed Cursor turn. Includes the real failure when there is one.
 */
export function cursorFailureChatMessage(reason: string): string {
  const detail = reason.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  if (!detail || /timed out/i.test(detail)) return CURSOR_NO_RESPONSE_MESSAGE;
  if (/without a reply|no reply|empty reply/i.test(detail)) {
    return CURSOR_EMPTY_RESPONSE_MESSAGE;
  }
  return `Koda couldn't finish that reply: ${detail}.`;
}

/**
 * Plan-only mode is gone. A program that still has a plan status, but already
 * has a GitHub repo, edits that repo in agent mode.
 */
export function shouldRunConnectedRepoAgent(input: {
  kind: string;
  status: string;
  hasRepository: boolean;
  iterateExisting?: boolean | null;
}): boolean {
  if (!input.hasRepository) return false;
  if (input.iterateExisting) return true;
  return (
    input.kind === "PROGRAM" &&
    (input.status === "PLANNING" || input.status === "AWAITING_PLAN_APPROVAL")
  );
}

const PUSH_NEGATIVE =
  /\b(?:don'?t|do not|never|without)\s+(?:push|deploy|commit)\b/i;

/** The whole message is a push/deploy command. */
const PUSH_ONLY =
  /^(?:please\s+|can you\s+|could you\s+|go ahead and\s+|ok(?:ay)?[, ]+)?(?:push|deploy)(?:\s+(?:it|this|now|that|the changes|these changes|to github))?[.!\s]*$/i;

/** A clear push/deploy phrase, including at the end of a change request. */
const PUSH_PHRASE =
  /\b(?:please\s+|can you\s+|could you\s+|go ahead and\s+)?(?:push\s+(?:it|this|now|that|the changes|these changes)|deploy\s+(?:it|this|now|that|the changes)|ship\s+it|commit and push|push and deploy)\b/i;

const PUSH_TRAILING =
  /\b(?:and\s+)?(?:then\s+)?(?:please\s+)?(?:push|deploy)(?:\s+(?:it|this|now|that))?[.!\s]*$/i;

/** True when the user is asking to push or deploy this change, not merely mentioning the word. */
export function isUserPushRequest(text: string): boolean {
  const raw = text.trim();
  if (!raw || PUSH_NEGATIVE.test(raw)) return false;
  if (PUSH_ONLY.test(raw) || PUSH_PHRASE.test(raw)) return true;
  return raw.length <= 500 && PUSH_TRAILING.test(raw);
}

export function connectedRepoAgentInstructions(): string {
  return [
    "You are Koda, working in the connected GitHub repository for this project.",
    "You may change any file, including restructuring the entire project, when the user asks. Do not limit yourself to tiny edits.",
    "Do not git commit and do not git push unless the user clearly asks to push or deploy.",
    "When they ask to push or deploy: commit only the work for that request (changes since the previous push) as one new commit, then push that commit. Do not amend, squash, or combine it with earlier pushes. Do not include a later unrelated request.",
    "If a change needs passwords or API keys, tell the user to use Add secrets / credentials in the chat form. Never ask them to paste secret values into chat.",
    "You may write a gitignored .env inside this workspace so you can run locally. Never commit .env, never force-add it, and never put secret values in git or in your reply. Production does not receive a gitignored .env.",
    "Speak in plain English. Do not mention internal tooling names in the reply.",
  ].join("\n");
}

export function connectedRepoStartPrompt(input: {
  title: string;
  repoLabel?: string | null;
}): string {
  return [
    connectedRepoAgentInstructions(),
    "",
    `Project: ${input.title}`,
    input.repoLabel ? `Repository: ${input.repoLabel}` : "",
    "",
    "The assigned user has not asked for a change yet. Do not edit files. Do not commit. Do not push. Reply briefly that you are ready for their requested changes.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function connectedRepoFollowUpPrompt(input: {
  customerMessage: string;
  pushRequest: boolean;
  repoLabel?: string | null;
}): string {
  const action = input.pushRequest
    ? "The user is asking to push or deploy now. If this message also describes a change, make that change first. Then commit only that work as one new commit and push it. Do not amend or squash earlier pushes, and do not include a later unrelated request."
    : "Make the requested change in the repository, including a full restructure if they asked for one. Do not commit and do not push.";
  return [
    connectedRepoAgentInstructions(),
    "",
    input.repoLabel ? `Repository: ${input.repoLabel}` : "",
    action,
    "",
    "# User message",
    input.customerMessage.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * This product does not configure a per-client AWS deploy (no ECS, App Runner,
 * or Elastic Beanstalk target on the project). Returns null until one exists.
 * Callers must not read stored secret values when this is null.
 */
export function readClientAwsDeployTarget(
  _repository: unknown,
): null {
  return null;
}

export function connectedRepoPushResultMessage(input: {
  repoLabel?: string | null;
  branch?: string | null;
  headSha?: string | null;
  previousSha?: string | null;
  previewLinked: boolean;
  awsTargetConnected: boolean;
}): string {
  const repo = input.repoLabel?.trim() || "the connected GitHub repo";
  const sha = input.headSha?.trim() || "";
  const moved = Boolean(sha && sha !== (input.previousSha ?? ""));
  const where = input.branch ? `${repo} (${input.branch})` : repo;
  const pushed = moved
    ? `Pushed that change as its own commit on ${where} at ${sha.slice(0, 7)}. You can revert that push on GitHub.`
    : `Asked Koda to commit and push that change on ${where}. If no new commit appears, say push again after the edit finishes.`;
  const preview = input.previewLinked
    ? "A Railway preview link is set for this repo, so the existing preview sync will refresh from that push."
    : "No Railway preview project id is set on this repo, so this push was not auto-deployed to a preview. The commit is still on GitHub.";
  const secrets = input.awsTargetConnected
    ? "Saved secrets for this project are applied from Koda's encrypted store when that AWS deploy runs. They are not in git."
    : "The AWS deploy target for this project is not connected yet, so saved secrets stay encrypted in Koda and were not sent to a host.";
  return `${pushed} ${preview} ${secrets}`;
}
