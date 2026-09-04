import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth } from "@/lib/request-auth";
import {
  requireChangeRequestAccess,
  requirePermission,
  AuthError,
  writeAuditEvent,
} from "@automation-studio/auth";
import { db, Prisma } from "@automation-studio/db";
import {
  encryptSecret,
  isCredentialSecretKey,
  normalizeSecretKeyName,
  secretSavedMessage,
  synthesizePlanMarkdown,
  type PlanningMeta,
} from "@automation-studio/domain";
import { requireRateLimit } from "@/lib/rate-limit";

const secretItemSchema = z.object({
  keyName: z.string().min(1).max(80),
  value: z.string().min(1).max(20000),
  label: z.string().max(120).optional(),
});

const postBodySchema = z.object({
  secrets: z.array(secretItemSchema).min(1).max(20),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const ctx = await getRequestAuth();
    await requirePermission(ctx, "change_request:chat");
    const cr = await requireChangeRequestAccess(ctx, id);
    const rows = await db.secretRef.findMany({
      where: {
        companyId: ctx.company.id,
        changeRequestId: cr.id,
        purpose: "CHAT",
        ciphertext: { not: null },
      },
      select: { keyName: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const secrets = rows
      .filter((r) => isCredentialSecretKey(r.keyName))
      .map((r) => ({ keyName: r.keyName, createdAt: r.createdAt.toISOString() }));
    return NextResponse.json({ secrets });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const ctx = await getRequestAuth();
    await requireRateLimit({
      preset: "secrets",
      scope: `${ctx.company.id}:${ctx.user.id}`,
    });
    await requirePermission(ctx, "change_request:chat");
    const cr = await requireChangeRequestAccess(ctx, id);
    const body = postBodySchema.parse(await request.json());
    const savedKeys: string[] = [];
    for (const item of body.secrets) {
      const keyName = normalizeSecretKeyName(item.keyName);
      if (!isCredentialSecretKey(keyName)) continue;
      const ciphertext = encryptSecret(item.value, ctx.company.id);
      await db.secretRef.upsert({
        where: {
          companyId_projectId_keyName_purpose: {
            companyId: ctx.company.id,
            projectId: cr.projectId,
            keyName,
            purpose: "CHAT",
          },
        },
        update: {
          externalRef: `chat://${cr.id}/${keyName}`,
          ciphertext,
          provider: "ENCRYPTED",
          changeRequestId: cr.id,
        },
        create: {
          companyId: ctx.company.id,
          projectId: cr.projectId,
          changeRequestId: cr.id,
          purpose: "CHAT",
          provider: "ENCRYPTED",
          keyName,
          externalRef: `chat://${cr.id}/${keyName}`,
          ciphertext,
        },
      });
      await db.changeRequestMessage.create({
        data: {
          changeRequestId: cr.id,
          authorId: ctx.user.id,
          role: "SYSTEM",
          content: secretSavedMessage(keyName),
          metadata: { secretSaved: true, secretRefs: [keyName] },
        },
      });
      savedKeys.push(keyName);
    }
    if (savedKeys.length === 0) {
      return NextResponse.json({ error: "No valid secrets to save" }, { status: 400 });
    }
    await writeAuditEvent({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "secret.saved_labeled",
      entityType: "change_request",
      entityId: cr.id,
      metadata: { keys: savedKeys },
    });
    const meta = (cr.planningMeta ?? {}) as PlanningMeta;
    const provided = new Set([...(meta.providedSecretKeys ?? []), ...savedKeys]);
    const nextMeta: PlanningMeta = { ...meta, providedSecretKeys: [...provided] };
    const planMarkdown = synthesizePlanMarkdown({
      title: cr.title,
      meta: nextMeta,
      latestUserContent: `Secrets provided: ${savedKeys.join(", ")}`,
      priorPlan: meta.planMarkdown,
    });
    nextMeta.planMarkdown = planMarkdown;
    await db.changeRequest.update({
      where: { id: cr.id },
      data: { planningMeta: nextMeta as Prisma.InputJsonValue, updatedAt: new Date() },
    });
    await db.plan.create({ data: { changeRequestId: cr.id, content: planMarkdown } });
    return NextResponse.json({
      ok: true,
      saved: savedKeys.map((keyName) => ({ keyName, message: secretSavedMessage(keyName) })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid secrets payload", details: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
