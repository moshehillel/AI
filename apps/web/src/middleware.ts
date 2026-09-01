import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAppBaseUrl } from "@/lib/app-url";
import {
  STAFF_COOKIE,
  isStaffProtectedPath,
  parseStaffSessionValue,
} from "@/lib/staff-session";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
/** Skip Clerk gate for open access / demo until NetFree allows Clerk. */
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
  const isPublicRoute = createRouteMatcher([
    "/",
    "/sign-in(.*)",
    "/sign-up(.*)",
    "/api/webhooks(.*)",
    "/api/github/app-manifest(.*)",
    "/api/health",
    "/api/ready",
    "/icon(.*)",
    "/favicon.ico",
    "/apple-icon(.*)",
    "/projects(.*)",
    "/select-org(.*)",
  ]);
  const mw = clerkMiddleware(async (auth, request) => {
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
  });
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

export default async function middleware(request: NextRequest) {
  const staffGate = await enforceStaffPasswordGate(request);
  if (staffGate) return staffGate;

  // No Clerk keys, or open access → skip protect (Clerk code remains for later).
  if (!clerkEnabled || skipClerkProtect) {
    return NextResponse.next();
  }
  const handler = await getClerkHandler();
  return handler(request);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
