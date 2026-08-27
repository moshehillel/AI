import { NextResponse } from "next/server";
import { db } from "@automation-studio/db";
import { writeAuditEvent } from "@automation-studio/auth";
import { appAdminUrl } from "@/lib/app-url";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const installationId = url.searchParams.get("installation_id");
  const state = url.searchParams.get("state");
  const setupAction = url.searchParams.get("setup_action");

  // GitHub sends setup_action=request when org admin approval is required (no installation_id yet).
  if (setupAction === "request") {
    return NextResponse.redirect(
      appAdminUrl("/admin?github=pending_approval"),
    );
  }

  if (!installationId) {
    return NextResponse.redirect(appAdminUrl("/admin?github=missing_params"));
  }

  // Post-install redirect includes installation_id + setup_action=install|update.
  // state is only present when the user started from /api/github/install (preserved by GitHub).
  if (!state) {
    return NextResponse.redirect(
      appAdminUrl(
        `/admin?github=installed&installation_id=${encodeURIComponent(installationId)}&manual=1`,
      ),
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
    return NextResponse.redirect(appAdminUrl("/admin?github=bad_state"));
  }

  if (!companyId) {
    return NextResponse.redirect(appAdminUrl("/admin?github=bad_state"));
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
    metadata: { installationId, setupAction },
  });

  return NextResponse.redirect(
    appAdminUrl(
      `/admin?github=installed&installation_id=${encodeURIComponent(installationId)}`,
    ),
  );
}
