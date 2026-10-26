/**
 * Public Clerk proxy paths. Safe to import from client components.
 * The secret-bearing forwarder lives in clerk-fapi-proxy.ts.
 */

export const CLERK_PROXY_PATH = "/__clerk";
/** Internal route the /__clerk rewrite targets. The browser does not call this. */
export const CLERK_PROXY_INTERNAL_PATH = "/api/clerk-fapi";
export const CLERK_FAPI_ORIGIN = "https://clerk.advancedautomations.net";
export const KODA_PRODUCTION_HOST = "koda.advancedautomations.net";

const PROXY_PREFIXES = [CLERK_PROXY_PATH, CLERK_PROXY_INTERNAL_PATH];

export function isClerkProxyPath(pathname: string): boolean {
  return PROXY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function clerkScriptUrl(proxyUrl: string): string {
  return `${proxyUrl.replace(/\/+$/, "")}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
}

function firstHeaderValue(value: string | null | undefined): string {
  return (value ?? "").split(",")[0]?.trim() ?? "";
}

function hostnameOf(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, "");
}

/**
 * Public proxy URL Clerk.js and the Clerk-Proxy-Url header must share.
 * An explicit NEXT_PUBLIC_CLERK_PROXY_URL wins. Otherwise Koda's production
 * host is inferred from the request so a build without that variable still proxies.
 */
export function clerkProxyUrlFromHeaders(input: {
  forwardedHost?: string | null;
  host?: string | null;
  forwardedProto?: string | null;
  proto?: string | null;
}): string | null {
  const explicit = process.env.NEXT_PUBLIC_CLERK_PROXY_URL?.trim().replace(
    /\/+$/,
    "",
  );
  if (explicit) return explicit;

  const hostname = hostnameOf(
    firstHeaderValue(input.forwardedHost) || firstHeaderValue(input.host),
  );
  if (hostname !== KODA_PRODUCTION_HOST) return null;
  const proto = firstHeaderValue(input.forwardedProto || input.proto) || "https";
  if (proto !== "https" && proto !== "http") return null;
  return `${proto}://${hostname}${CLERK_PROXY_PATH}`;
}

/** Map a browser or rewritten proxy URL onto the Clerk Frontend API origin. */
export function clerkFrontendApiTarget(requestUrl: URL): URL | null {
  const prefix = PROXY_PREFIXES.find(
    (item) =>
      requestUrl.pathname === item || requestUrl.pathname.startsWith(`${item}/`),
  );
  if (!prefix) return null;

  let rest = requestUrl.pathname.slice(prefix.length) || "/";
  if (!rest.startsWith("/")) rest = `/${rest}`;
  if (rest.startsWith("//") || rest.includes("\\") || rest.includes("://")) {
    return null;
  }

  const target = new URL(`${CLERK_FAPI_ORIGIN}${rest}`);
  if (target.origin !== CLERK_FAPI_ORIGIN) return null;
  target.search = requestUrl.search;
  return target;
}
