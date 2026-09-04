export class CursorRateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = "CursorRateLimitError";
  }
}

function isRateLimitStatus(status: number): boolean {
  return status === 429 || status === 503;
}

function parseRetryAfterMs(response: Response): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number.parseInt(header, 10);
    if (Number.isFinite(seconds)) return seconds * 1000;
  }
  return 5000;
}

/** Wrap Cursor SDK / REST calls with exponential backoff on 429/503. */
export async function withCursorRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; baseDelayMs?: number },
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 5;
  const baseDelayMs = opts?.baseDelayMs ?? 2000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status =
        error &&
        typeof error === "object" &&
        "status" in error &&
        typeof (error as { status: unknown }).status === "number"
          ? (error as { status: number }).status
          : null;
      const retryAfterMs =
        error instanceof CursorRateLimitError
          ? error.retryAfterMs
          : status && isRateLimitStatus(status)
            ? baseDelayMs * attempt
            : null;

      if (!retryAfterMs || attempt >= maxAttempts) {
        throw error;
      }

      const delay = Math.min(
        60_000,
        retryAfterMs + Math.floor(Math.random() * 500),
      );
      console.warn(
        `[cursor-adapter] ${label} rate limited — retry ${attempt}/${maxAttempts} in ${delay}ms`,
      );
      await sleep(delay);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function cursorFetchWithRetry(
  label: string,
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  return withCursorRetry(label, async () => {
    const response = await fetch(input, init);
    if (isRateLimitStatus(response.status)) {
      throw new CursorRateLimitError(
        `Cursor API ${response.status}`,
        parseRetryAfterMs(response),
      );
    }
    return response;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
