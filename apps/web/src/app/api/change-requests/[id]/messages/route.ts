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
  detectAndRedactSecrets,
  encryptSecret,
  canProgramCustomerChat,
  isProgramVerifyPhase,
  cursorFailureChatMessage,
  isUserPushRequest,
  connectedRepoFollowUpPrompt,
  shouldRunConnectedRepoAgent,
  clientVerifyFollowUpPrompt,
  preparePlanningUserPrompt,
  type PlanningMeta,
  type QueuedAgentTurn,
} from "@automation-studio/domain";
import { enqueueJob } from "@automation-studio/jobs";
import { requireRateLimit } from "@/lib/rate-limit";

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

function buildAgentFollowUpPrompt(userContent: string): {
  prompt: string;
  wasLong: boolean;
} {
  const prepared = preparePlanningUserPrompt(userContent);
  return {
    prompt: prepared.prompt,
    wasLong: prepared.wasLong,
  };
}

async function enqueueOrQueuePlanningTurn(opts: {
  changeRequestId: string;
  companyId: string;
  userMessageId: string;
  followUpPrompt?: string;
  startPrompt?: string;
  wasLongMessage: boolean;
  attachmentRefs: string[];
  delayMs?: number;
  mode?: "plan" | "agent";
  pushRequest?: boolean;
  /** Keep this turn separate so it is not merged into another push. */
  separateTurn?: boolean;
}): Promise<{ queued: boolean }> {
  const runningTurn = await db.agentRun.count({
    where: { changeRequestId: opts.changeRequestId, status: "RUNNING" },
  });
  const row = await db.changeRequest.findUnique({
    where: { id: opts.changeRequestId },
    select: { planningMeta: true, cursorAgentId: true },
  });
  const meta = (row?.planningMeta ?? {}) as PlanningMeta;
  const turnBusy = runningTurn > 0 || Boolean(meta.inFlightTurnAt);

  const progressLabel = opts.wasLongMessage
    ? "Processing your long note…"
    : turnBusy
      ? "Queued — will send when the current reply finishes…"
      : null;

  if (turnBusy && opts.followUpPrompt) {
    const separate: QueuedAgentTurn[] | null = opts.separateTurn
      ? [
          ...(meta.queuedTurns ?? []),
          {
            prompt: opts.followUpPrompt,
            attachmentRefs: opts.attachmentRefs.length
              ? opts.attachmentRefs
              : undefined,
            userMessageId: opts.userMessageId,
            mode: opts.mode ?? "agent",
            pushRequest: opts.pushRequest || undefined,
          },
        ].slice(-8)
      : null;
    await db.changeRequest.update({
      where: { id: opts.changeRequestId },
      data: {
        planningMeta: {
          ...meta,
          ...(separate
            ? { queuedTurns: separate }
            : {
                queuedFollowUp: {
                  prompt: opts.followUpPrompt,
                  attachmentRefs: opts.attachmentRefs.length
                    ? opts.attachmentRefs
                    : undefined,
                  userMessageId: opts.userMessageId,
                  mode: opts.mode,
                  pushRequest: opts.pushRequest,
                },
              }),
          ...(progressLabel ? { liveProgress: progressLabel } : {}),
        } as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });
    return { queued: true };
  }

  if (progressLabel) {
    await db.changeRequest.update({
      where: { id: opts.changeRequestId },
      data: {
        planningMeta: {
          ...meta,
          liveProgress: progressLabel,
        } as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });
  }

  const jobOpts = {
    delay: opts.delayMs,
    jobId: opts.separateTurn
      ? `cursor-turn-${opts.changeRequestId}-${opts.userMessageId}`
      : opts.followUpPrompt
        ? `cursor-follow-up-${opts.changeRequestId}`
        : `cursor-start-${opts.changeRequestId}`,
  };

  if (opts.followUpPrompt && row?.cursorAgentId) {
    await enqueueJob(
      "cursor.follow-up",
      {
        changeRequestId: opts.changeRequestId,
        companyId: opts.companyId,
        prompt: opts.followUpPrompt,
        mode: "agent",
        pushRequest: opts.pushRequest,
        attachmentRefs: opts.attachmentRefs.length
          ? opts.attachmentRefs
          : undefined,
        attachmentRef: opts.attachmentRefs[0],
        wasLongMessage: opts.wasLongMessage,
        userMessageId: opts.userMessageId,
      },
      jobOpts,
    );
  } else if (opts.startPrompt) {
    await enqueueJob(
      "cursor.start-agent",
      {
        changeRequestId: opts.changeRequestId,
        companyId: opts.companyId,
        mode: "agent",
        pushRequest: opts.pushRequest,
        prompt: opts.startPrompt,
        attachmentRefs: opts.attachmentRefs.length
          ? opts.attachmentRefs
          : undefined,
        attachmentRef: opts.attachmentRefs[0],
        wasLongMessage: opts.wasLongMessage,
        userMessageId: opts.userMessageId,
      },
      jobOpts,
    );
  }

  return { queued: false };
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
    await requireRateLimit({
      preset: "messages",
      scope: `${ctx.company.id}:${ctx.user.id}`,
    });
    await requirePermission(ctx, "change_request:chat");
    const cr = await requireChangeRequestAccess(ctx, id);
    const body = bodySchema.parse(await request.json());

    if (cr.kind === "PROGRAM" && !canProgramCustomerChat(cr.status)) {
      throw new AuthError(
        cr.status === "AWAITING_DEV_BUILD" ||
        cr.status === "BUILDING" ||
        cr.status === "TESTING"
          ? "Planning is closed while your developer builds. You will get an Ask about your app chat when the preview is ready."
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
          ciphertext: encryptSecret(secret.value, ctx.company.id),
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
          ciphertext: encryptSecret(secret.value, ctx.company.id),
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

    const planningMetaNow = (cr.planningMeta ?? {}) as PlanningMeta;
    let connectedRepo = Boolean(planningMetaNow.iterateExisting);
    if (!connectedRepo && cr.kind === "PROGRAM") {
      const linked = await db.changeRequest.findFirst({
        where: { id: cr.id },
        include: { project: { include: { repository: true } } },
      });
      const repository = linked?.project.repository ?? null;
      if (
        repository &&
        shouldRunConnectedRepoAgent({
          kind: cr.kind,
          status: cr.status,
          hasRepository: true,
          iterateExisting: planningMetaNow.iterateExisting,
        })
      ) {
        planningMetaNow.iterateExisting = true;
        planningMetaNow.linkedRepoLabel = `${repository.githubOwner}/${repository.githubRepo}`;
        connectedRepo = true;
        await db.changeRequest.update({
          where: { id: cr.id },
          data: { planningMeta: planningMetaNow as Prisma.InputJsonValue },
        });
      }
    }
    const pushRequest = connectedRepo && isUserPushRequest(redacted);

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
    let turnQueued = false;

    const agentFollowUp = buildAgentFollowUpPrompt(redacted);

    if (connectedRepo && cr.cursorAgentId) {
      const prepared = preparePlanningUserPrompt(redacted);
      const prompt = connectedRepoFollowUpPrompt({
        customerMessage: prepared.prompt,
        pushRequest,
        repoLabel: planningMetaNow.linkedRepoLabel,
      });
      const { queued } = await enqueueOrQueuePlanningTurn({
        changeRequestId: cr.id,
        companyId: ctx.company.id,
        userMessageId: message.id,
        followUpPrompt: prompt,
        wasLongMessage: prepared.wasLong,
        attachmentRefs: fileAttachmentRefs,
        mode: "agent",
        pushRequest,
        separateTurn: true,
      });
      turnQueued = queued;
    } else if (connectedRepo) {
      const full = await db.changeRequest.findFirstOrThrow({
        where: { id: cr.id },
        include: { project: { include: { repository: true } } },
      });
      const repository = full.project.repository;
      if (!repository) {
        throw new AuthError(
          "No repository linked — an admin must connect the GitHub repo first.",
          400,
        );
      }
      const prepared = preparePlanningUserPrompt(redacted);
      const prompt = connectedRepoFollowUpPrompt({
        customerMessage: prepared.prompt,
        pushRequest,
        repoLabel: `${repository.githubOwner}/${repository.githubRepo}`,
      });
      if (full.branchName && full.cursorAgentId) {
        const { queued } = await enqueueOrQueuePlanningTurn({
          changeRequestId: cr.id,
          companyId: ctx.company.id,
          userMessageId: message.id,
          followUpPrompt: prompt,
          wasLongMessage: prepared.wasLong,
          attachmentRefs: fileAttachmentRefs,
          mode: "agent",
          pushRequest,
          separateTurn: true,
        });
        turnQueued = queued;
      } else if (full.branchName) {
        const { queued } = await enqueueOrQueuePlanningTurn({
          changeRequestId: cr.id,
          companyId: ctx.company.id,
          userMessageId: message.id,
          startPrompt: prompt,
          wasLongMessage: prepared.wasLong,
          attachmentRefs: fileAttachmentRefs,
          mode: "agent",
          pushRequest,
          separateTurn: true,
        });
        turnQueued = queued;
      } else {
        await enqueueJob("github.ensure-branch", {
          changeRequestId: cr.id,
          companyId: ctx.company.id,
          mode: "agent",
          prompt,
          pushRequest,
          attachmentRef: fileAttachmentRefs[0],
          attachmentRefs: fileAttachmentRefs.length
            ? fileAttachmentRefs
            : undefined,
        });
      }
      if (!turnQueued) {
        const created = await db.changeRequestMessage.create({
          data: {
            changeRequestId: cr.id,
            role: "SYSTEM",
            content: pushRequest
              ? "Koda will commit and push this change on its own."
              : "Koda is editing the connected repository. Say push when you want that change as its own commit.",
            metadata: { connectedRepoTurn: true, pushRequest },
          },
        });
        assistantMessage = {
          id: created.id,
          role: created.role,
          content: created.content,
          createdAt: created.createdAt.toISOString(),
        };
      }
    } else if (cr.cursorAgentId) {
      if (fullForVerify && isProgramVerifyPhase(cr.status)) {
        const verifyPrompt = clientVerifyFollowUpPrompt({
          title: cr.title,
          planMarkdown:
            fullForVerify.plans[0]?.content ??
            (cr.planningMeta as { planMarkdown?: string } | null)
              ?.planMarkdown ??
            cr.description,
          customerMessage: preparePlanningUserPrompt(redacted).prompt,
          previewUrl: fullForVerify.previews[0]?.url,
        });
        await enqueueJob("cursor.follow-up", {
          changeRequestId: cr.id,
          companyId: ctx.company.id,
          prompt: verifyPrompt,
          mode: "agent",
          attachmentRef: fileAttachmentRefs[0],
          attachmentRefs: fileAttachmentRefs.length
            ? fileAttachmentRefs
            : undefined,
          wasLongMessage: preparePlanningUserPrompt(redacted).wasLong,
          userMessageId: message.id,
        });
      } else {
        const { queued } = await enqueueOrQueuePlanningTurn({
          changeRequestId: cr.id,
          companyId: ctx.company.id,
          userMessageId: message.id,
          followUpPrompt: agentFollowUp.prompt,
          wasLongMessage: agentFollowUp.wasLong,
          attachmentRefs: fileAttachmentRefs,
          mode: "agent",
        });
        turnQueued = queued;
      }
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
          mode: "agent",
          prompt: verifyStartPrompt,
          attachmentRef: fileAttachmentRefs[0],
          attachmentRefs: fileAttachmentRefs.length
            ? fileAttachmentRefs
            : undefined,
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
    } else if (
      cr.kind === "PROGRAM" &&
      (cr.status === "PLANNING" || cr.status === "AWAITING_PLAN_APPROVAL")
    ) {
      const created = await db.changeRequestMessage.create({
        data: {
          changeRequestId: cr.id,
          role: "ASSISTANT",
          content: cursorFailureChatMessage(
            "this chat has no connected GitHub repo. An admin has to connect one before Koda can edit it",
          ),
        },
      });
      assistantMessage = {
        id: created.id,
        role: created.role,
        content: created.content,
        createdAt: created.createdAt.toISOString(),
      };
    }

    return NextResponse.json({
      message: {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      },
      assistantMessage,
      turnQueued,
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
