import { checkRateLimit, type RateLimitResult } from "@automation-studio/jobs";
import { AuthError } from "@automation-studio/auth";

export type ApiRateLimitPreset =
  | "messages"
  | "submit"
  | "secrets"
  | "upload"
  | "staff_unlock";

const PRESETS: Record<
  ApiRateLimitPreset,
  { limit: number; windowSec: number }
> = {
  messages: { limit: 30, windowSec: 60 },
  submit: { limit: 10, windowSec: 60 },
  secrets: { limit: 20, windowSec: 60 },
  upload: { limit: 15, windowSec: 60 },
  staff_unlock: { limit: 8, windowSec: 300 },
};

function envOverride(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function enforceApiRateLimit(input: {
  preset: ApiRateLimitPreset;
  scope: string;
}): Promise<RateLimitResult> {
  const preset = PRESETS[input.preset];
  const limitEnv =
    input.preset === "messages"
      ? "RATE_LIMIT_MESSAGES_PER_MIN"
      : input.preset === "submit"
        ? "RATE_LIMIT_SUBMIT_PER_MIN"
        : input.preset === "secrets"
          ? "RATE_LIMIT_SECRETS_PER_MIN"
          : input.preset === "staff_unlock"
            ? "RATE_LIMIT_STAFF_UNLOCK"
            : "RATE_LIMIT_UPLOAD_PER_MIN";

  const limit = envOverride(limitEnv, preset.limit);
  return checkRateLimit({
    key: `${input.preset}:${input.scope}`,
    limit,
    windowSec: preset.windowSec,
  });
}

export function rateLimitResponse(result: Extract<RateLimitResult, { ok: false }>) {
  return Response.json(
    {
      error: "Too many requests — please wait a moment and try again.",
      retryAfterSec: result.retryAfterSec,
    },
    {
      status: 429,
      headers: { "Retry-After": String(result.retryAfterSec) },
    },
  );
}

export async function requireRateLimit(input: {
  preset: ApiRateLimitPreset;
  scope: string;
}): Promise<void> {
  const result = await enforceApiRateLimit(input);
  if (!result.ok) {
    throw new AuthError(
      `Too many requests — try again in ${result.retryAfterSec}s`,
      429,
    );
  }
}
