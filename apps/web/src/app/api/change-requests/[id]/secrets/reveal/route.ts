import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth } from "@/lib/request-auth";
import {
  requireChangeRequestAccess,
  requirePermission,
  AuthError,
  writeAuditEvent,
} from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import {
  decryptSecret,
  isCredentialSecretKey,
  normalizeSecretKeyName,
} from "@automation-studio/domain";

const bodySchema = z.object({ keyName: z.string().min(1).max(80) });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const ctx = await getRequestAuth();
    await requirePermission(ctx, "program:reveal_secrets");
    const cr = await requireChangeRequestAccess(ctx, id);
    const body = bodySchema.parse(await request.json());
    const keyName = normalizeSecretKeyName(body.keyName);
    if (!isCredentialSecretKey(keyName)) {
      return NextResponse.json({ error: "Not a credential secret" }, { status: 400 });
    }
    const row = await db.secretRef.findFirst({
      where: {
        changeRequestId: cr.id,
        companyId: ctx.company.id,
        purpose: "CHAT",
        keyName,
      },
      select: { ciphertext: true, keyName: true },
    });
    if (!row?.ciphertext) {
      return NextResponse.json({ error: "Secret not found" }, { status: 404 });
    }
    let value: string;
    try {
      value = decryptSecret(row.ciphertext, ctx.company.id);
    } catch {
      return NextResponse.json(
        { error: "Could not decrypt secret — check ENCRYPTION_KEY" },
        { status: 500 },
      );
    }
    await writeAuditEvent({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "secret.revealed",
      entityType: "change_request",
      entityId: cr.id,
      metadata: { keyName: row.keyName },
    });
    return NextResponse.json(
      { keyName: row.keyName, value },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, private", Pragma: "no-cache" } },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
