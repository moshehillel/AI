import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAppBaseUrl } from "@/lib/app-url";
import {
  clerkProxyUrlFromHeaders,
  isClerkProxyPath,
} from "@/lib/clerk-proxy-config";
import {
  STAFF_COOKIE,
  isStaffProtectedPath,
  parseStaffSessionValue,
} from "@/lib/staff-session";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
/** Single-customer no-login mode (local dev only in production). */
const openAccess =
  process.env.OPEN_ACCESS === "1" || process.env.NEXT_PUBLIC_OPEN_ACCESS === "1";
const skipClerkProtect =
  openAccess || process.env.ALLOW_DEMO_AUTH === "1";

let clerkHandler:
  | ((request: NextRequest) => Promise<NextResponse | Response>)
  | null = null;

async function getClerkHandler() {
  if (clerkHandler) return clerkHandler;
  const { clerkMiddleware, createRouteMatcher } = await import(
    "@clerk/nextjs/server"
  );
  const publicRoutes = [
    "/",
    "/sign-in(.*)",
    "/sign-up(.*)",
    "/staff(.*)",
    "/api/webhooks(.*)",
    "/api/github/app-manifest(.*)",
    "/api/staff(.*)",
    "/api/health",
    "/api/ready",
    "/__clerk(.*)",
    "/api/clerk-fapi(.*)",
    "/icon(.*)",
    "/favicon.ico",
    "/apple-icon(.*)",
  ];
  // Open access only: customer routes without Clerk session.
  if (openAccess) {
    publicRoutes.push("/projects(.*)", "/select-org(.*)");
  }
  const isPublicRoute = createRouteMatcher(publicRoutes);
  const mw = clerkMiddleware(
    async (auth, request) => {
      if (isPublicRoute(request)) return;
      if (skipClerkProtect) return;
      const session = await auth();
      if (!session.userId) {
        const returnBackUrl = new URL(
          `${request.nextUrl.pathname}${request.nextUrl.search}`,
          getAppBaseUrl(),
        ).toString();
        return session.redirectToSignIn({ returnBackUrl });
      }
    },
    (request) => {
      const proxyUrl = clerkProxyUrlFromHeaders({
        forwardedHost: request.headers.get("x-forwarded-host"),
        host: request.headers.get("host"),
        forwardedProto: request.headers.get("x-forwarded-proto"),
        proto: request.nextUrl.protocol.replace(":", ""),
      });
      return proxyUrl ? { proxyUrl } : {};
    },
  );
  clerkHandler = mw as unknown as typeof clerkHandler;
  return clerkHandler!;
}

/** While open access is on, admin/staff UI requires a signed staff cookie. */
async function enforceStaffPasswordGate(request: NextRequest) {
  if (!openAccess) return null;
  const { pathname, search } = request.nextUrl;
  if (pathname === "/staff" || pathname.startsWith("/staff/")) return null;
  if (pathname.startsWith("/api/staff/")) return null;
  if (!isStaffProtectedPath(pathname)) return null;

  const role = await parseStaffSessionValue(
    request.cookies.get(STAFF_COOKIE)?.value,
  );
  if (role) return null;

  const next = `${pathname}${search}`;
  const login = request.nextUrl.clone();
  login.pathname = "/staff";
  login.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(login);
}

const CLERK_MIDDLEWARE_TIMEOUT_MS = 3_000;

function clerkMiddlewareTimedOut(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "The sign-in service took too long to respond." },
      { status: 504 },
    );
  }
  if (
    pathname === "/" ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/staff")
  ) {
    return NextResponse.next();
  }
  const signIn = request.nextUrl.clone();
  const returnPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  signIn.pathname = "/sign-in";
  signIn.search = `?redirect_url=${encodeURIComponent(returnPath)}`;
  return NextResponse.redirect(signIn);
}

export default async function middleware(request: NextRequest) {
  // The proxy route forwards /__clerk itself. Middleware must not wrap that
  // response: it buffers the body, so Clerk's scripts delay the first byte
  // and a stalled upstream holds the HTML request.
  if (isClerkProxyPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const staffGate = await enforceStaffPasswordGate(request);
  if (staffGate) return staffGate;

  // No Clerk keys, open access, or demo auth → skip Clerk protect.
  if (!clerkEnabled || skipClerkProtect) {
    return NextResponse.next();
  }
  const handler = await getClerkHandler();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      handler(request),
      new Promise<NextResponse>((resolve) => {
        timer = setTimeout(
          () => resolve(clerkMiddlewareTimedOut(request)),
          CLERK_MIDDLEWARE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const config = {
  matcher: [
    "/((?!_next|__clerk|api/clerk-fapi|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api(?!/clerk-fapi)|trpc)(.*)",
  ],
};
