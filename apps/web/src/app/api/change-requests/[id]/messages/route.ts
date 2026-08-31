import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth } from "@/lib/request-auth";
import {
  requireChangeRequestAccess,
  requirePermission,
  AuthError,
  writeAuditEvent,
} from "@automation-studio/auth";
import { db, Prisma, ensurePlanningRepository } from "@automation-studio/db";
import {
  detectAndRedactSecrets,
  encryptSecret,
  isProgramPlanOnly,
  buildPlanningFollowUp,
  buildPlanningStartPrompt,
  getDefaultGithubRepoConfig,
  isLiveCursorConfigured,
  type PlanningMeta,
} from "@automation-studio/domain";
import { enqueueJob } from "@automation-studio/jobs";

const attachmentSchema = z
  .object({
    kind: z.enum(["api_docs_url", "docs_text", "examples", "file"]),
    value: z.string().min(1).max(20000),
    fileName: z.string().max(260).optional(),
    /** SecretRef keyName for encrypted agent file payload (PDF images / Excel CSV). */
    attachmentRef: z.string().max(120).optional(),
  })
  .optional();

const bodySchema = z.object({
  content: z.string().max(20000).optional(),
  attachment: attachmentSchema,
}).superRefine((value, ctx) => {
  const content = value.content?.trim() ?? "";
  if (!content && !value.attachment) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Message or attachment required",
      path: ["content"],
    });
  }
  if (value.attachment?.kind === "api_docs_url") {
    try {
      // eslint-disable-next-line no-new
      new URL(value.attachment.value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid API docs URL",
        path: ["attachment", "value"],
      });
    }
  }
});

function composeUserContent(
  content: string,
  attachment?: z.infer<typeof attachmentSchema>,
): string {
  if (!attachment) return content;
  const label =
    attachment.kind === "api_docs_url"
      ? `Attached API docs URL: ${attachment.value}`
      : attachment.kind === "docs_text"
        ? `Attached documentation:\n${attachment.value}`
        : attachment.kind === "examples"
          ? `Attached examples:\n${attachment.value}`
          : `Attached file${attachment.fileName ? ` (${attachment.fileName})` : ""}:\n${attachment.value}`;
  return content ? `${content}\n\n${label}` : label;
}

function mergePlanningAttachment(
  meta: PlanningMeta,
  attachment?: z.infer<typeof attachmentSchema>,
): PlanningMeta {
  if (!attachment) return meta;
  if (attachment.kind === "api_docs_url") {
    return { ...meta, apiDocsUrl: attachment.value };
  }
  if (attachment.kind === "docs_text" || attachment.kind === "file") {
    // Keep planningMeta docsText short — never dump full Excel/PDF into Goal context.
    const prior = meta.docsText ? `${meta.docsText}\n\n` : "";
    const prefix =
      attachment.kind === "file" && attachment.fileName
        ? `[${attachment.fileName}]\n`
        : "";
    const clipped = attachment.value.slice(0, 4000);
    return {
      ...meta,
      docsText: `${prior}${prefix}${clipped}`.slice(0, 12000),
      ...(attachment.attachmentRef
        ? { pendingAttachmentRef: attachment.attachmentRef }
        : {}),
    };
  }
  const prior = meta.examples ? `${meta.examples}\n\n` : "";
  return {
    ...meta,
    examples: `${prior}${attachment.value}`.slice(0, 40000),
  };
}

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

    const rawContent = composeUserContent(
      body.content?.trim() ?? "",
      body.attachment,
    );
    const { redacted, secrets, hadSecrets } = detectAndRedactSecrets(rawContent);

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

      const meta = (cr.planningMeta ?? {}) as PlanningMeta;
      const provided = new Set([
        ...(meta.providedSecretKeys ?? []),
        ...secrets.map((s) => s.keyName),
      ]);
      await db.changeRequest.update({
        where: { id: cr.id },
        data: {
          planningMeta: {
            ...meta,
            providedSecretKeys: [...provided],
          } as Prisma.InputJsonValue,
        },
      });
    }

    const message = await db.changeRequestMessage.create({
      data: {
        changeRequestId: cr.id,
        authorId: ctx.user.id,
        role: "USER",
        content: redacted,
        metadata: {
          ...(hadSecrets
            ? {
                secretsRedacted: true,
                secretRefs: secrets.map((s) => s.keyName),
              }
            : {}),
          ...(body.attachment
            ? {
                attachmentKind: body.attachment.kind,
                ...(body.attachment.attachmentRef
                  ? { attachmentRef: body.attachment.attachmentRef }
                  : {}),
                ...(body.attachment.fileName
                  ? { fileName: body.attachment.fileName }
                  : {}),
              }
            : {}),
        },
      },
    });

    if (hadSecrets) {
      await db.changeRequestMessage.create({
        data: {
          changeRequestId: cr.id,
          role: "SYSTEM",
          content: `Detected and securely stored ${secrets.length} secret(s): ${secrets.map((s) => s.keyName).join(", ")}. They will not appear in chat again. Developers can reveal them from the Build desk when building.`,
        },
      });
    }

    const forcePlan =
      cr.kind === "PROGRAM" && isProgramPlanOnly(cr.status);

    let assistantMessage: {
      id: string;
      role: string;
      content: string;
      createdAt: string;
    } | null = null;

    if (cr.cursorAgentId) {
      await enqueueJob("cursor.follow-up", {
        changeRequestId: cr.id,
        companyId: ctx.company.id,
        prompt: redacted,
        mode: forcePlan ? "plan" : "agent",
        attachmentRef: body.attachment?.attachmentRef,
      });
    } else if (cr.kind === "PROGRAM" && isProgramPlanOnly(cr.status)) {
      const full = await db.changeRequest.findFirstOrThrow({
        where: { id: cr.id },
        include: { project: { include: { repository: true } } },
      });

      const currentMeta = mergePlanningAttachment(
        (cr.planningMeta ?? {}) as PlanningMeta,
        body.attachment,
      );

      // Auto-link a planning repo (sibling project or DEFAULT_GITHUB_*) so we
      // can start live Cursor plan mode instead of the local template fallback.
      let repository = full.project.repository;
      if (!repository) {
        repository = await ensurePlanningRepository(db, {
          projectId: cr.projectId,
          companyId: ctx.company.id,
          defaults: getDefaultGithubRepoConfig(),
        });
      }

      const canStartLive = Boolean(repository) && isLiveCursorConfigured();

      if (canStartLive) {
        // Prefer live Cursor plan mode — kick off (or continue) agent startup.
        await db.changeRequest.update({
          where: { id: cr.id },
          data: {
            planningMeta: currentMeta as Prisma.InputJsonValue,
            updatedAt: new Date(),
          },
        });

        if (full.branchName) {
          const history = await db.changeRequestMessage.findMany({
            where: { changeRequestId: cr.id },
            orderBy: { createdAt: "asc" },
            take: 40,
          });
          await enqueueJob("cursor.start-agent", {
            changeRequestId: cr.id,
            companyId: ctx.company.id,
            mode: "plan",
            prompt: buildPlanningStartPrompt({
              title: cr.title,
              description: cr.description,
              messages: history.map((m) => ({
                role: m.role,
                content: m.content,
              })),
              planningMeta: currentMeta,
            }),
            attachmentRef: body.attachment?.attachmentRef,
          });
        } else {
          await enqueueJob(
            "github.ensure-branch",
            {
              changeRequestId: cr.id,
              companyId: ctx.company.id,
            },
            { jobId: `plan-branch-${cr.id}` },
          );
        }

        const created = await db.changeRequestMessage.create({
          data: {
            changeRequestId: cr.id,
            role: "SYSTEM",
            content:
              "Koda is connecting your live planning session… replies will appear here in a moment.",
            metadata: { planningSessionStarting: true },
          },
        });
        assistantMessage = {
          id: created.id,
          role: created.role,
          content: created.content,
          createdAt: created.createdAt.toISOString(),
        };
      } else {
        // No live Cursor path available — keyword-aware local planning.
        const { content, nextMeta, planMarkdown } = buildPlanningFollowUp({
          meta: currentMeta,
          latestUserContent: redacted,
          attachmentKind: body.attachment?.kind ?? null,
          title: cr.title,
        });

        await db.changeRequest.update({
          where: { id: cr.id },
          data: {
            planningMeta: nextMeta as Prisma.InputJsonValue,
            updatedAt: new Date(),
          },
        });

        await db.plan.create({
          data: {
            changeRequestId: cr.id,
            content: planMarkdown,
          },
        });

        const created = await db.changeRequestMessage.create({
          data: {
            changeRequestId: cr.id,
            role: "ASSISTANT",
            content,
            metadata: {
              planningFollowUp: true,
              localPlanFallback: true,
              reason: !repository
                ? "no_repository"
                : "cursor_not_configured",
            },
          },
        });
        assistantMessage = {
          id: created.id,
          role: created.role,
          content: created.content,
          createdAt: created.createdAt.toISOString(),
        };
      }
    } else if (
      cr.kind === "PROGRAM" &&
      body.attachment &&
      isProgramPlanOnly(cr.status)
    ) {
      const currentMeta = (cr.planningMeta ?? {}) as PlanningMeta;
      await db.changeRequest.update({
        where: { id: cr.id },
        data: {
          planningMeta: mergePlanningAttachment(
            currentMeta,
            body.attachment,
          ) as Prisma.InputJsonValue,
          updatedAt: new Date(),
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
      assistantMessage,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      const flat = error.flatten();
      const firstField = Object.values(flat.fieldErrors).flat()[0];
      return NextResponse.json(
        {
          error: firstField || flat.formErrors[0] || "Invalid message or attachment",
          details: flat,
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
