import { NextResponse } from "next/server";
import { getRequestAuth } from "@/lib/request-auth";
import { requireChangeRequestAccess, AuthError } from "@automation-studio/auth";
import { db } from "@automation-studio/db";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const ctx = await getRequestAuth();
    await requireChangeRequestAccess(ctx, id);

    const changeRequest = await db.changeRequest.findFirstOrThrow({
      where: { id, companyId: ctx.company.id },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        plans: { orderBy: { createdAt: "desc" }, take: 1 },
        previews: { orderBy: { createdAt: "desc" }, take: 1 },
        pullRequests: { orderBy: { createdAt: "desc" }, take: 1 },
        ciChecks: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    return NextResponse.json({
      id: changeRequest.id,
      status: changeRequest.status,
      classification: changeRequest.classification,
      messages: changeRequest.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
      plan: changeRequest.plans[0] ?? null,
      preview: changeRequest.previews[0] ?? null,
      pullRequest: changeRequest.pullRequests[0] ?? null,
      ci: changeRequest.ciChecks[0] ?? null,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
