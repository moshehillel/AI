import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAppBaseUrl } from "@/lib/app-url";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
/** Skip Clerk gate for open access / demo until NetFree allows Clerk. */
const skipClerkProtect =
  process.env.OPEN_ACCESS === "1" || process.env.ALLOW_DEMO_AUTH === "1";

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

export default async function middleware(request: NextRequest) {
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
