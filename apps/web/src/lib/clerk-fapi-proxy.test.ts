import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildClerkProxyHeaders,
  CLERK_PROXY_TIMEOUT_MS,
  clerkNpmCacheKey,
  rewriteClerkSetCookie,
  shouldStripProxyResponseHeader,
} from "./clerk-fapi-proxy.ts";
import {
  CLERK_FAPI_ORIGIN,
  clerkFrontendApiTarget,
  clerkProxyUrlFromHeaders,
  clerkScriptUrl,
  isClerkProxyPath,
} from "./clerk-proxy-config.ts";

describe("clerk frontend api proxy", () => {
  it("sends the browser path to the Clerk host", () => {
    const target = clerkFrontendApiTarget(
      new URL(
        "https://koda.advancedautomations.net/__clerk/v1/client?_clerk_js_version=5.128.0",
      ),
    );
    assert.ok(target);
    assert.equal(target.origin, CLERK_FAPI_ORIGIN);
    assert.equal(target.pathname, "/v1/client");
    assert.equal(target.searchParams.get("_clerk_js_version"), "5.128.0");
  });

  it("accepts the internal rewrite path", () => {
    const target = clerkFrontendApiTarget(
      new URL("https://koda.advancedautomations.net/api/clerk-fapi/v1/me/organization_memberships"),
    );
    assert.equal(target?.pathname, "/v1/me/organization_memberships");
  });

  it("refuses a path that would change hosts", () => {
    assert.equal(
      clerkFrontendApiTarget(
        new URL("https://koda.advancedautomations.net/__clerk//evil.example/v1/client"),
      ),
      null,
    );
    assert.equal(
      clerkFrontendApiTarget(new URL("https://koda.advancedautomations.net/v1/client")),
      null,
    );
  });

  it("sets the proxy headers Clerk requires and drops a client-supplied secret", () => {
    const incoming = new Headers({
      origin: "https://koda.advancedautomations.net",
      cookie: "session=present",
      "x-forwarded-for": "203.0.113.8, 10.0.0.1",
      "clerk-secret-key": "from-browser",
      connection: "close",
    });
    const target = clerkFrontendApiTarget(
      new URL("https://koda.advancedautomations.net/__clerk/v1/client"),
    );
    assert.ok(target);
    const headers = buildClerkProxyHeaders(incoming, {
      proxyUrl: "https://koda.advancedautomations.net/__clerk",
      target,
    });

    assert.equal(headers.get("Clerk-Proxy-Url"), null);
    assert.equal(headers.get("Clerk-Secret-Key"), null);
    assert.equal(headers.get("X-Forwarded-For"), "203.0.113.8");
    assert.equal(headers.get("X-Forwarded-Host"), "koda.advancedautomations.net");
    assert.equal(headers.get("X-Forwarded-Proto"), "https");
    assert.equal(headers.get("Host"), "clerk.advancedautomations.net");
    assert.equal(headers.get("Origin"), "https://koda.advancedautomations.net");
    assert.equal(headers.get("cookie"), "session=present");
    assert.equal(headers.get("connection"), null);
    assert.equal(JSON.stringify(Object.fromEntries(headers)).includes("from-browser"), false);
  });

  it("uses the Koda host when the public proxy env is unset", () => {
    const previous = process.env.NEXT_PUBLIC_CLERK_PROXY_URL;
    delete process.env.NEXT_PUBLIC_CLERK_PROXY_URL;
    try {
      assert.equal(
        clerkProxyUrlFromHeaders({
          forwardedHost: "koda.advancedautomations.net",
          forwardedProto: "https",
        }),
        "https://koda.advancedautomations.net/__clerk",
      );
      assert.equal(
        clerkProxyUrlFromHeaders({ host: "localhost:3000", proto: "http" }),
        null,
      );
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_CLERK_PROXY_URL;
      else process.env.NEXT_PUBLIC_CLERK_PROXY_URL = previous;
    }
  });

  it("stores Clerk cookies on Koda instead of the filtered host", () => {
    const rewritten = rewriteClerkSetCookie(
      "__client=value; Domain=clerk.advancedautomations.net; Path=/; Secure; HttpOnly",
    );
    assert.equal(rewritten.includes("Domain"), false);
    assert.equal(rewritten.includes("value"), true);
    assert.equal(rewritten.includes("Secure"), true);
  });

  it("keeps content-length so the proxy can flush before the body ends", () => {
    const plain = new Headers({
      "content-type": "application/javascript",
      "content-length": "120",
      "cache-control": "public, max-age=31536000, immutable",
    });
    assert.equal(shouldStripProxyResponseHeader("content-length", plain), false);
    assert.equal(shouldStripProxyResponseHeader("content-encoding", plain), true);

    const encoded = new Headers({
      "content-encoding": "gzip",
      "content-length": "80",
    });
    assert.equal(shouldStripProxyResponseHeader("content-length", encoded), true);
    assert.equal(shouldStripProxyResponseHeader("set-cookie", plain), true);
  });

  it("gives the Clerk upstream a short timeout and caches only script assets", () => {
    assert.equal(CLERK_PROXY_TIMEOUT_MS <= 8_000, true);
    assert.equal(CLERK_PROXY_TIMEOUT_MS >= 1_000, true);
    assert.equal(
      clerkNpmCacheKey(
        new URL(
          "https://clerk.advancedautomations.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js",
        ),
      ),
      "/npm/@clerk/clerk-js@5/dist/clerk.browser.js",
    );
    assert.equal(
      clerkNpmCacheKey(new URL("https://clerk.advancedautomations.net/v1/client")),
      null,
    );
  });

  it("recognizes both proxy paths and builds the script url on Koda", () => {
    assert.equal(isClerkProxyPath("/__clerk/v1/client"), true);
    assert.equal(isClerkProxyPath("/api/clerk-fapi/npm/clerk.js"), true);
    assert.equal(isClerkProxyPath("/api/health"), false);
    assert.equal(
      clerkScriptUrl("https://koda.advancedautomations.net/__clerk"),
      "https://koda.advancedautomations.net/__clerk/npm/@clerk/clerk-js@5/dist/clerk.browser.js",
    );
  });
});
