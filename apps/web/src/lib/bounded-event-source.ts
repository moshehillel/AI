/** Shown when the live-updates stream fails instead of reconnecting forever. */
export const LIVE_UPDATES_STOPPED_MESSAGE =
  "Live updates stopped because the connection failed, so Koda left the thinking state. Refresh to try again.";

const OPEN_TIMEOUT_MS = 15_000;
const MAX_ERRORS = 3;

/**
 * EventSource reconnects forever on its own. Close it after repeated failures
 * or if it never opens, and report that once.
 */
export function openBoundedEventSource(
  url: string,
  handlers: {
    onOpen?: () => void;
    onMessage: (data: string) => void;
    onGiveUp?: (message: string) => void;
  },
): () => void {
  if (typeof EventSource === "undefined") {
    handlers.onGiveUp?.(LIVE_UPDATES_STOPPED_MESSAGE);
    return () => {};
  }

  const source = new EventSource(url);
  let stopped = false;
  let opened = false;
  let errors = 0;

  const stop = (message?: string) => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    source.close();
    if (message) handlers.onGiveUp?.(message);
  };

  const timer = window.setTimeout(() => {
    if (!opened) stop(LIVE_UPDATES_STOPPED_MESSAGE);
  }, OPEN_TIMEOUT_MS);

  source.onopen = () => {
    opened = true;
    errors = 0;
    window.clearTimeout(timer);
    handlers.onOpen?.();
  };

  source.onmessage = (event) => {
    opened = true;
    errors = 0;
    handlers.onMessage(String(event.data ?? ""));
  };

  source.onerror = () => {
    if (stopped) return;
    errors += 1;
    if (source.readyState === EventSource.CLOSED || errors >= MAX_ERRORS) {
      stop(LIVE_UPDATES_STOPPED_MESSAGE);
    }
  };

  return () => {
    stopped = true;
    window.clearTimeout(timer);
    source.close();
  };
}
