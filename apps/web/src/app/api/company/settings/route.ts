import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth } from "@/lib/request-auth";
import { AuthError, writeAuditEvent } from "@automation-studio/auth";
import { db, type Prisma } from "@automation-studio/db";
import { parseCompanySettings } from "@automation-studio/domain";

const bodySchema = z.object({
  usageSoftCapCents: z.number().int().nonnegative().nullable().optional(),
  usageSoftCapTokens: z.number().int().nonnegative().nullable().optional(),
  allowAdminDeploy: z.boolean().optional(),
});

export async function GET() {
  try {
    const ctx = await getRequestAuth();
    if (ctx.role !== "ADMIN") throw new AuthError("Forbidden", 403);
    const company = await db.company.findUniqueOrThrow({
      where: { id: ctx.company.id },
    });
    return NextResponse.json({
      settings: parseCompanySettings(company.settings),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await getRequestAuth();
    if (ctx.role !== "ADMIN") throw new AuthError("Forbidden", 403);
    const patch = bodySchema.parse(await request.json());
    const company = await db.company.findUniqueOrThrow({
      where: { id: ctx.company.id },
    });
    const current = parseCompanySettings(company.settings);
    const next = { ...current, ...patch };
    await db.company.update({
      where: { id: company.id },
      data: { settings: next as Prisma.InputJsonValue },
    });
    await writeAuditEvent({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "company.settings_updated",
      entityType: "company",
      entityId: company.id,
      metadata: next,
    });
    return NextResponse.json({ settings: next });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
