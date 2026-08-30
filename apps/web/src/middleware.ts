import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAppBaseUrl } from "@/lib/app-url";
import { isOpenAccess } from "@/lib/open-access";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
/** Temporary explore mode: skip Clerk gate when demo auth is on. */
const demoAuthEnabled = process.env.ALLOW_DEMO_AUTH === "1";
/** Temporary single-customer open access (NetFree / Clerk blocked). */
const openAccessEnabled = isOpenAccess();

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
    // App Router metadata icons (extensionless /icon can otherwise hit protect())
    "/icon(.*)",
    "/favicon.ico",
    "/apple-icon(.*)",
  ]);
  // Prefer explicit redirect over auth.protect()'s rewrite, which surfaces as a
  // confusing 404 when Clerk development keys lack a "dev browser" cookie.
  const mw = clerkMiddleware(async (auth, request) => {
    if (isPublicRoute(request)) return;
    // Open access / demo: no sign-in gate while Clerk is blocked or exploring.
    if (openAccessEnabled || demoAuthEnabled) return;
    const session = await auth();
    if (!session.userId) {
      // request.url is localhost behind Railway; use the public origin.
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
  // No Clerk keys, or temporary open access → all app routes open.
  if (!clerkEnabled || openAccessEnabled) {
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
