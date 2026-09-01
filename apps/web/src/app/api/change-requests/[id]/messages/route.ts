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
  canProgramCustomerChat,
  isProgramVerifyPhase,
  buildPlanningFollowUp,
  buildPlanningStartPrompt,
  getDefaultGithubRepoConfig,
  isLiveCursorConfigured,
  planningAgentInstructions,
  clientVerifyFollowUpPrompt,
  type PlanningMeta,
} from "@automation-studio/domain";
import { enqueueJob } from "@automation-studio/jobs";

const attachmentItemSchema = z.object({
  kind: z.enum(["api_docs_url", "docs_text", "examples", "file"]),
  value: z.string().min(1).max(20000),
  fileName: z.string().max(260).optional(),
  /** SecretRef keyName for encrypted agent file payload (PDF / Excel / text). */
  attachmentRef: z.string().max(120).optional(),
});

const bodySchema = z
  .object({
    content: z.string().max(20000).optional(),
    /** Single attachment (legacy). */
    attachment: attachmentItemSchema.optional(),
    /** Multiple file attachments sent with one message. */
    attachments: z.array(attachmentItemSchema).max(5).optional(),
  })
  .superRefine((value, ctx) => {
    const content = value.content?.trim() ?? "";
    const list = [
      ...(value.attachments ?? []),
      ...(value.attachment ? [value.attachment] : []),
    ];
    if (!content && list.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Message or attachment required",
        path: ["content"],
      });
    }
    for (const [i, att] of list.entries()) {
      if (att.kind === "api_docs_url") {
        try {
          // eslint-disable-next-line no-new
          new URL(att.value);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid API docs URL",
            path: value.attachments?.length
              ? ["attachments", i, "value"]
              : ["attachment", "value"],
          });
        }
      }
    }
  });

type AttachmentItem = z.infer<typeof attachmentItemSchema>;

function normalizeAttachments(body: z.infer<typeof bodySchema>): AttachmentItem[] {
  const list = [
    ...(body.attachments ?? []),
    ...(body.attachment ? [body.attachment] : []),
  ];
  // Dedupe by attachmentRef when present
  const seen = new Set<string>();
  const out: AttachmentItem[] = [];
  for (const a of list) {
    const key = a.attachmentRef || `${a.kind}:${a.fileName ?? ""}:${a.value.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out.slice(0, 5);
}

function composeUserContent(
  content: string,
  attachments: AttachmentItem[],
): string {
  if (!attachments.length) return content;
  const blocks = attachments.map((attachment) => {
    if (attachment.kind === "api_docs_url") {
      return `Attached API docs URL: ${attachment.value}`;
    }
    if (attachment.kind === "docs_text") {
      return `Attached documentation:\n${attachment.value}`;
    }
    if (attachment.kind === "examples") {
      return `Attached examples:\n${attachment.value}`;
    }
    return `Attached file${attachment.fileName ? ` (${attachment.fileName})` : ""}:\n${attachment.value}`;
  });
  const attached = blocks.join("\n\n");
  return content ? `${content}\n\n${attached}` : attached;
}

function mergePlanningAttachments(
  meta: PlanningMeta,
  attachments: AttachmentItem[],
): PlanningMeta {
  let next = { ...meta };
  const refs = [
    ...(next.pendingAttachmentRefs ?? []),
    ...(next.pendingAttachmentRef ? [next.pendingAttachmentRef] : []),
  ];
  for (const attachment of attachments) {
    if (attachment.kind === "api_docs_url") {
      next = { ...next, apiDocsUrl: attachment.value };
      continue;
    }
    if (attachment.kind === "docs_text" || attachment.kind === "file") {
      const prior = next.docsText ? `${next.docsText}\n\n` : "";
      const prefix =
        attachment.kind === "file" && attachment.fileName
          ? `[${attachment.fileName}]\n`
          : "";
      const clipped = attachment.value.slice(0, 4000);
      next = {
        ...next,
        docsText: `${prior}${prefix}${clipped}`.slice(0, 12000),
      };
      if (attachment.attachmentRef) refs.push(attachment.attachmentRef);
      continue;
    }
    const prior = next.examples ? `${next.examples}\n\n` : "";
    next = {
      ...next,
      examples: `${prior}${attachment.value}`.slice(0, 40000),
    };
  }
  const uniqueRefs = [...new Set(refs.filter(Boolean))];
  if (uniqueRefs.length) {
    next = {
      ...next,
      pendingAttachmentRefs: uniqueRefs,
      pendingAttachmentRef: uniqueRefs[uniqueRefs.length - 1] ?? null,
    };
  }
  return next;
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

    if (cr.kind === "PROGRAM" && !canProgramCustomerChat(cr.status)) {
      throw new AuthError(
        cr.status === "AWAITING_DEV_BUILD" ||
        cr.status === "BUILDING" ||
        cr.status === "TESTING"
          ? "Planning is closed while your developer builds. You will get a Test & request changes chat when the preview is ready."
          : "Chat is not available in this phase. Submit for final review or wait for your developer.",
        400,
      );
    }

    const attachments = normalizeAttachments(body);
    const primaryAttachment = attachments[0];
    const fileAttachmentRefs = attachments
      .map((a) => a.attachmentRef)
      .filter((r): r is string => Boolean(r));

    const rawContent = composeUserContent(
      body.content?.trim() ?? "",
      attachments,
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

    const fileNames = attachments
      .map((a) => a.fileName)
      .filter((name): name is string => Boolean(name));

    const messageMetadata: Record<string, string | boolean | string[]> = {};
    if (hadSecrets) {
      messageMetadata.secretsRedacted = true;
      messageMetadata.secretRefs = secrets.map((s) => s.keyName);
    }
    if (attachments.length && primaryAttachment) {
      messageMetadata.attachmentKind = primaryAttachment.kind;
      if (fileAttachmentRefs.length === 1 && fileAttachmentRefs[0]) {
        messageMetadata.attachmentRef = fileAttachmentRefs[0];
      }
      if (fileAttachmentRefs.length) {
        messageMetadata.attachmentRefs = fileAttachmentRefs;
      }
      if (fileNames.length) {
        messageMetadata.fileNames = fileNames;
      }
      if (primaryAttachment.fileName) {
        messageMetadata.fileName = primaryAttachment.fileName;
      }
    }

    const message = await db.changeRequestMessage.create({
      data: {
        changeRequestId: cr.id,
        authorId: ctx.user.id,
        role: "USER",
        content: redacted,
        metadata: messageMetadata as Prisma.InputJsonValue,
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

    const fullForVerify =
      cr.kind === "PROGRAM" && isProgramVerifyPhase(cr.status)
        ? await db.changeRequest.findFirst({
            where: { id: cr.id },
            include: {
              project: { include: { repository: true } },
              plans: { orderBy: { createdAt: "desc" }, take: 1 },
              previews: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          })
        : null;

    let assistantMessage: {
      id: string;
      role: string;
      content: string;
      createdAt: string;
    } | null = null;

    if (cr.cursorAgentId) {
      const verifyPrompt =
        fullForVerify && isProgramVerifyPhase(cr.status)
          ? clientVerifyFollowUpPrompt({
              title: cr.title,
              planMarkdown:
                fullForVerify.plans[0]?.content ??
                (cr.planningMeta as { planMarkdown?: string } | null)
                  ?.planMarkdown ??
                cr.description,
              customerMessage: redacted,
              previewUrl: fullForVerify.previews[0]?.url,
            })
          : redacted;
      await enqueueJob("cursor.follow-up", {
        changeRequestId: cr.id,
        companyId: ctx.company.id,
        prompt: verifyPrompt,
        mode: forcePlan ? "plan" : "agent",
        attachmentRef: fileAttachmentRefs[0],
        attachmentRefs: fileAttachmentRefs.length
          ? fileAttachmentRefs
          : undefined,
      });
    } else if (fullForVerify && isProgramVerifyPhase(cr.status)) {
      const repository = fullForVerify.project.repository;
      if (!repository) {
        throw new AuthError(
          "No repository linked — developer must connect a repo before verification chat",
          400,
        );
      }
      const planMarkdown =
        fullForVerify.plans[0]?.content ??
        (cr.planningMeta as { planMarkdown?: string } | null)?.planMarkdown ??
        cr.description;
      const verifyStartPrompt = clientVerifyFollowUpPrompt({
        title: cr.title,
        planMarkdown,
        customerMessage: redacted,
        previewUrl: fullForVerify.previews[0]?.url,
      });
      if (fullForVerify.branchName) {
        await enqueueJob("cursor.start-agent", {
          changeRequestId: cr.id,
          companyId: ctx.company.id,
          mode: "agent",
          prompt: verifyStartPrompt,
          attachmentRef: fileAttachmentRefs[0],
          attachmentRefs: fileAttachmentRefs.length
            ? fileAttachmentRefs
            : undefined,
        });
      } else {
        await enqueueJob("github.ensure-branch", {
          changeRequestId: cr.id,
          companyId: ctx.company.id,
        });
      }
      const created = await db.changeRequestMessage.create({
        data: {
          changeRequestId: cr.id,
          role: "SYSTEM",
          content:
            "Koda is connecting to your build… replies about testing and changes will appear here shortly.",
          metadata: { verifySessionStarting: true },
        },
      });
      assistantMessage = {
        id: created.id,
        role: created.role,
        content: created.content,
        createdAt: created.createdAt.toISOString(),
      };
    } else if (cr.kind === "PROGRAM" && isProgramPlanOnly(cr.status)) {
      const full = await db.changeRequest.findFirstOrThrow({
        where: { id: cr.id },
        include: { project: { include: { repository: true } } },
      });

      const currentMeta = mergePlanningAttachments(
        (cr.planningMeta ?? {}) as PlanningMeta,
        attachments,
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
          const bootstrapping = await db.agentRun.count({
            where: { changeRequestId: cr.id, status: "RUNNING" },
          });
          if (bootstrapping > 0) {
            await enqueueJob(
              "cursor.follow-up",
              {
                changeRequestId: cr.id,
                companyId: ctx.company.id,
                prompt: `${planningAgentInstructions()}\n\nClient message:\n${redacted}`,
                mode: "plan",
                attachmentRef: fileAttachmentRefs[0],
                attachmentRefs: fileAttachmentRefs.length
                  ? fileAttachmentRefs
                  : undefined,
              },
              {
                delay: 12000,
                jobId: `cursor-follow-up-${cr.id}`,
              },
            );
          } else {
            await enqueueJob(
              "cursor.start-agent",
              {
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
                attachmentRef: fileAttachmentRefs[0],
                attachmentRefs: fileAttachmentRefs.length
                  ? fileAttachmentRefs
                  : undefined,
              },
              { jobId: `cursor-start-${cr.id}` },
            );
          }
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
          attachmentKind: primaryAttachment?.kind ?? null,
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
      attachments.length &&
      isProgramPlanOnly(cr.status)
    ) {
      const currentMeta = (cr.planningMeta ?? {}) as PlanningMeta;
      await db.changeRequest.update({
        where: { id: cr.id },
        data: {
          planningMeta: mergePlanningAttachments(
            currentMeta,
            attachments,
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
