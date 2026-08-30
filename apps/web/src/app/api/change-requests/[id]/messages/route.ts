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
  detectAndRedactSecrets,
  encryptSecret,
  isProgramPlanOnly,
} from "@automation-studio/domain";
import { enqueueJob } from "@automation-studio/jobs";

const bodySchema = z.object({
  content: z.string().min(1).max(20000),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const ctx = await getRequestAuth();
    await requirePermission(ctx, "change_request:chat");
    const cr = await requireChangeRequestAccess(ctx, id);
    const body = bodySchema.parse(await request.json());

    const { redacted, secrets, hadSecrets } = detectAndRedactSecrets(body.content);

    for (const secret of secrets) {
      await db.secretRef.upsert({
        where: {
          companyId_projectId_keyName_purpose: {
            companyId: ctx.company.id,
            projectId: cr.projectId,
            keyName: secret.keyName,
            purpose: "CHAT",
          },
        },
        update: {
          externalRef: `chat://${cr.id}/${secret.keyName}`,
          ciphertext: encryptSecret(secret.value),
          provider: "ENCRYPTED",
          changeRequestId: cr.id,
        },
        create: {
          companyId: ctx.company.id,
          projectId: cr.projectId,
          changeRequestId: cr.id,
          purpose: "CHAT",
          provider: "ENCRYPTED",
          keyName: secret.keyName,
          externalRef: `chat://${cr.id}/${secret.keyName}`,
          ciphertext: encryptSecret(secret.value),
        },
      });
    }

    if (hadSecrets) {
      await writeAuditEvent({
        companyId: ctx.company.id,
        actorId: ctx.user.id,
        action: "secret.captured_from_chat",
        entityType: "change_request",
        entityId: cr.id,
        metadata: { keys: secrets.map((s) => s.keyName) },
      });
    }

    const message = await db.changeRequestMessage.create({
      data: {
        changeRequestId: cr.id,
        authorId: ctx.user.id,
        role: "USER",
        content: redacted,
        metadata: hadSecrets
          ? { secretsRedacted: true, secretRefs: secrets.map((s) => s.keyName) }
          : {},
      },
    });

    if (hadSecrets) {
      await db.changeRequestMessage.create({
        data: {
          changeRequestId: cr.id,
          role: "SYSTEM",
          content: `Detected and securely stored ${secrets.length} secret(s). They will not appear in chat again. Developers can inject them into the runtime environment when building.`,
        },
      });
    }

    const forcePlan =
      cr.kind === "PROGRAM" && isProgramPlanOnly(cr.status);

    if (cr.cursorAgentId) {
      await enqueueJob("cursor.follow-up", {
        changeRequestId: cr.id,
        companyId: ctx.company.id,
        prompt: redacted,
        mode: forcePlan ? "plan" : "agent",
      });
    } else if (cr.kind === "PROGRAM" && cr.status === "PLANNING") {
      // Lightweight planning reply without backend when no agent yet
      await db.changeRequestMessage.create({
        data: {
          changeRequestId: cr.id,
          role: "ASSISTANT",
          content: [
            "Got it — I've added that to the program plan.",
            "",
            "Keep sharing details, or refine acceptance criteria. When the plan feels complete, submit to a developer for building.",
            "",
            "Koda is AI and can make mistakes.",
          ].join("\n"),
        },
      });
    }

    return NextResponse.json({
      message: {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
