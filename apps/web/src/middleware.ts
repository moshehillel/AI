import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

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
  const mw = clerkMiddleware(async (auth, request) => {
    if (!isPublicRoute(request)) {
      await auth.protect();
    }
  });
  clerkHandler = mw as unknown as typeof clerkHandler;
  return clerkHandler!;
}

export default async function middleware(request: NextRequest) {
  if (!clerkEnabled) {
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
