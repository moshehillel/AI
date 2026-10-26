/**
 * Forwards same-origin /__clerk requests to the Clerk Frontend API.
 * Import this only from the Node route handler. It reads CLERK_SECRET_KEY.
 */
import {
  clerkFrontendApiTarget,
  clerkProxyUrlFromHeaders,
  CLERK_FAPI_HOSTS,
  CLERK_FAPI_ORIGIN,
  CLERK_PROXY_PATH,
} from "./clerk-proxy-config";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const RESPONSE_HEADERS_TO_STRIP = new Set(["content-encoding", "content-length"]);

function dynamicHopByHop(headers: Headers): Set<string> {
  const connection = headers.get("connection");
  if (!connection) return new Set();
  return new Set(
    connection
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function clientIp(headers: Headers): string | undefined {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || undefined;
  return undefined;
}

export function buildClerkProxyHeaders(
  requestHeaders: Headers,
  options: { proxyUrl: string; target: URL },
): Headers {
  const headers = new Headers();
  const dynamic = dynamicHopByHop(requestHeaders);
  requestHeaders.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || dynamic.has(lower)) return;
    if (lower === "content-length" || lower === "host") return;
    if (lower === "clerk-secret-key" || lower === "clerk-proxy-url") return;
    headers.set(key, value);
  });

  // Do not add Clerk-Proxy-Url or Clerk-Secret-Key. This production instance
  // returns host_invalid for that pair, and Clerk will not accept a proxy_url
  // on koda.advancedautomations.net. Forward the browser request instead.
  headers.set("Host", options.target.host);
  headers.set("Accept-Encoding", "identity");

  if (!headers.has("x-forwarded-host")) {
    headers.set("X-Forwarded-Host", new URL(options.proxyUrl).host);
  }
  if (!headers.has("x-forwarded-proto")) {
    headers.set(
      "X-Forwarded-Proto",
      new URL(options.proxyUrl).protocol.replace(":", ""),
    );
  }
  const ip = clientIp(requestHeaders);
  if (ip) headers.set("X-Forwarded-For", ip);
  return headers;
}

function proxyUrlForRequest(request: Request, requestUrl: URL): string {
  const fromHeaders = clerkProxyUrlFromHeaders({
    forwardedHost: request.headers.get("x-forwarded-host"),
    host: request.headers.get("host") ?? requestUrl.host,
    forwardedProto: request.headers.get("x-forwarded-proto"),
    proto: requestUrl.protocol.replace(":", ""),
  });
  if (fromHeaders) return fromHeaders;
  const app = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (app && !app.includes("localhost")) return `${app}${CLERK_PROXY_PATH}`;
  return `${requestUrl.protocol}//${requestUrl.host}${CLERK_PROXY_PATH}`;
}

function copyResponseHeaders(source: Headers, proxyUrl: string, target: URL): Headers {
  const headers = new Headers();
  const dynamic = dynamicHopByHop(source);
  source.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "set-cookie") return;
    if (
      HOP_BY_HOP_HEADERS.has(lower) ||
      RESPONSE_HEADERS_TO_STRIP.has(lower) ||
      dynamic.has(lower)
    ) {
      return;
    }
    headers.set(key, value);
  });

  const cookies =
    typeof source.getSetCookie === "function" ? source.getSetCookie() : [];
  const rawCookies =
    cookies.length > 0
      ? cookies
      : source.get("set-cookie")
        ? [source.get("set-cookie") as string]
        : [];
  for (const cookie of rawCookies) {
    headers.append("set-cookie", rewriteClerkSetCookie(cookie));
  }

  const location = source.get("location");
  if (location) {
    try {
      const locationUrl = new URL(location, target.origin);
      if (CLERK_FAPI_HOSTS.has(locationUrl.host)) {
        headers.set(
          "Location",
          `${proxyUrl}${locationUrl.pathname}${locationUrl.search}${locationUrl.hash}`,
        );
      }
    } catch {
      // Leave a non-URL Location value untouched.
    }
  }
  return headers;
}

function proxyError(message: string, status: number): Response {
  return new Response(
    JSON.stringify({
      errors: [{ code: "proxy_request_failed", message }],
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}

export function rewriteClerkSetCookie(cookie: string): string {
  const parts = cookie.split(";").flatMap((part) => {
    const trimmed = part.trim();
    const name = trimmed.split("=")[0]?.toLowerCase();
    if (name !== "domain") return [part];
    const domain = trimmed.slice(trimmed.indexOf("=") + 1).trim().toLowerCase().replace(/^\./, "");
    if (
      domain === "clerk.advancedautomations.net" ||
      domain === "advancedautomations.net"
    ) {
      return [];
    }
    return [part];
  });
  return parts.join(";").replace(/;\s*;/g, ";").trim();
}

export async function proxyClerkFrontendApi(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const target = clerkFrontendApiTarget(requestUrl);
  if (!target || target.origin !== CLERK_FAPI_ORIGIN) {
    return proxyError("Request path is outside the Clerk proxy.", 404);
  }

  const proxyUrl = proxyUrlForRequest(request, requestUrl);
  const headers = buildClerkProxyHeaders(request.headers, {
    proxyUrl,
    target,
  });

  const hasBody =
    request.method !== "GET" && request.method !== "HEAD" && request.body !== null;
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (hasBody) {
    init.body = request.body;
    init.duplex = "half";
  }

  try {
    const response = await fetch(target, init);
    const responseHeaders = copyResponseHeaders(response.headers, proxyUrl, target);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch {
    return proxyError("The sign-in service could not be reached.", 502);
  }
}
