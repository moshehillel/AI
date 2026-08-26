import { NextResponse } from "next/server";
import { db } from "@automation-studio/db";
import { writeAuditEvent } from "@automation-studio/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const installationId = url.searchParams.get("installation_id");
  const state = url.searchParams.get("state");

  if (!installationId || !state) {
    return NextResponse.redirect(
      new URL("/admin?github=missing_params", request.url),
    );
  }

  let companyId: string | undefined;
  let userId: string | undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(state, "base64url").toString("utf8"),
    ) as { companyId?: string; userId?: string };
    companyId = parsed.companyId;
    userId = parsed.userId;
  } catch {
    return NextResponse.redirect(
      new URL("/admin?github=bad_state", request.url),
    );
  }

  if (!companyId) {
    return NextResponse.redirect(
      new URL("/admin?github=bad_state", request.url),
    );
  }

  await db.githubInstallation.upsert({
    where: { installationId },
    update: {
      companyId,
      accountLogin: "pending",
      accountType: "Organization",
    },
    create: {
      companyId,
      installationId,
      accountLogin: "pending",
      accountType: "Organization",
    },
  });

  await writeAuditEvent({
    companyId,
    actorId: userId,
    action: "github.install_completed",
    entityType: "company",
    entityId: companyId,
    metadata: { installationId },
  });

  return NextResponse.redirect(
    new URL(`/admin?github=installed&installation_id=${installationId}`, request.url),
  );
}
