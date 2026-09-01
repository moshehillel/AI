import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getRequestAuth } from "@/lib/request-auth";
import {
  AuthError,
  requireChangeRequestAccess,
  requirePermission,
} from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import { encryptSecret } from "@automation-studio/domain";
import { preparePlanningAttachment } from "@/lib/planning-attach";
import { requireRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Accept a planning chat file (PDF / Excel / CSV / text), prepare a short
 * human summary plus a Cursor-agent payload (PDF pages → PNG images; Excel →
 * structured CSV), and store the agent payload encrypted for the follow-up job.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const ctx = await getRequestAuth();
    await requireRateLimit({
      preset: "upload",
      scope: `${ctx.company.id}:${ctx.user.id}`,
    });
    await requirePermission(ctx, "change_request:chat");
    const cr = await requireChangeRequestAccess(ctx, id);

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file upload." }, { status: 400 });
    }

    const prepared = await preparePlanningAttachment(file);
    if (!prepared.ok) {
      return NextResponse.json({ error: prepared.error }, { status: 400 });
    }

    const attachmentKey = `planning-file-${randomBytes(8).toString("hex")}`;
    const ciphertext = encryptSecret(
      JSON.stringify(prepared.prepared.payload),
      ctx.company.id,
    );

    await db.secretRef.upsert({
      where: {
        companyId_projectId_keyName_purpose: {
          companyId: ctx.company.id,
          projectId: cr.projectId,
          keyName: attachmentKey,
          purpose: "CHAT",
        },
      },
      update: {
        externalRef: `planning-file://${cr.id}/${attachmentKey}`,
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
        keyName: attachmentKey,
        externalRef: `planning-file://${cr.id}/${attachmentKey}`,
        ciphertext,
      },
    });

    console.info(
      `[attach-file] cr=${cr.id} kind=${prepared.prepared.kind} file=${prepared.prepared.fileName} images=${prepared.prepared.payload.images?.length ?? 0} agentTextChars=${prepared.prepared.payload.agentText?.length ?? 0} ref=${attachmentKey}`,
    );

    return NextResponse.json({
      fileName: prepared.prepared.fileName,
      kind: prepared.prepared.kind,
      excerpt: prepared.prepared.chatSummary,
      attachmentRef: attachmentKey,
      agentImages: prepared.prepared.payload.images?.length ?? 0,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[attach-file] failed", error);
    return NextResponse.json({ error: "Could not process that file." }, { status: 500 });
  }
}
