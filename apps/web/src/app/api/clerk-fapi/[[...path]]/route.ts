import { proxyClerkFrontendApi } from "@/lib/clerk-fapi-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(request: Request) {
  return proxyClerkFrontendApi(request);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
