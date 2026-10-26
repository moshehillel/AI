import { CLERK_PROXY_PATH } from "./clerk-proxy-config";

/**
 * After sign-in, Clerk's organization switcher polls three endpoints and
 * retries network failures. A local HTTPS filter (the HAR shows
 * net::ERR_FAILED and Server: Livigent) makes those retries continue.
 * Stop them after the first blocked attempt and tell the page.
 * The same polls through the same-origin /__clerk proxy are covered too,
 * so a failed proxy does not retry forever.
 */

export const BLOCKED_SIGN_IN_REQUEST_MESSAGE =
  "This browser blocked requests to the sign-in service (clerk.advancedautomations.net), so Koda stopped those retries and left the thinking state. A network filter can cause this. Allow that host, then refresh.";

const CLERK_ORG_POLLS = new Set([
  "/v1/me/organization_memberships",
  "/v1/me/organization_invitations",
  "/v1/me/organization_suggestions",
]);

const listeners = new Set<() => void>();
const stoppedPaths = new Set<string>();
let notified = false;

export function clerkOrganizationPollPath(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  let path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === CLERK_PROXY_PATH || path.startsWith(`${CLERK_PROXY_PATH}/`)) {
    path = path.slice(CLERK_PROXY_PATH.length) || "/";
  } else if (!url.hostname.toLowerCase().includes("clerk")) {
    return null;
  }
  return CLERK_ORG_POLLS.has(path) ? path : null;
}

export function requestUrl(input: RequestInfo | URL): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return null;
}

/** HTML, a proxy timeout, or a non-JSON error is a failed poll, not a Clerk payload. */
export function isFilterBlockResponse(
  contentType: string | null,
  ok: boolean,
  status?: number,
): boolean {
  if (status === 502 || status === 504) return true;
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("text/html")) return true;
  if (!ok && !type.includes("json")) return true;
  return false;
}

export function emptyClerkPollResponse(): Response {
  return new Response(
    JSON.stringify({ response: { data: [], total_count: 0 } }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

export function subscribeBlockedSignInRequest(listener: () => void): () => void {
  listeners.add(listener);
  if (notified) listener();
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  if (notified) return;
  notified = true;
  for (const listener of listeners) listener();
}

function rememberFailure(path: string): void {
  stoppedPaths.add(path);
  notify();
}

export function installBlockedRequestGuard(): void {
  if (typeof window === "undefined") return;
  const host = window as Window & { __kodaBlockedRequestGuard?: boolean };
  if (host.__kodaBlockedRequestGuard) return;
  host.__kodaBlockedRequestGuard = true;

  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = requestUrl(input);
    const path = raw ? clerkOrganizationPollPath(raw) : null;
    if (path && stoppedPaths.has(path)) {
      return emptyClerkPollResponse();
    }
    try {
      const response = await original(input, init);
      if (
        path &&
        isFilterBlockResponse(
          response.headers.get("content-type"),
          response.ok,
          response.status,
        )
      ) {
        rememberFailure(path);
        return emptyClerkPollResponse();
      }
      return response;
    } catch (error) {
      if (path) {
        rememberFailure(path);
        return emptyClerkPollResponse();
      }
      throw error;
    }
  };
}
