import { NextResponse } from "next/server";
import { getRequestAuth } from "@/lib/request-auth";
import { AuthError, writeAuditEvent } from "@automation-studio/auth";
import { db } from "@automation-studio/db";
import { getGitHubAppInstallUrl } from "@automation-studio/github";
import { getAppBaseUrl } from "@/lib/app-url";

export async function GET() {
  try {
    const ctx = await getRequestAuth();
    if (ctx.role !== "ADMIN" && ctx.role !== "DEVELOPER") {
      throw new AuthError("Forbidden", 403);
    }

    const state = Buffer.from(
      JSON.stringify({ companyId: ctx.company.id, userId: ctx.user.id }),
    ).toString("base64url");

    const url =
      getGitHubAppInstallUrl(state) ??
      (process.env.GITHUB_MOCK === "1" || !process.env.GITHUB_APP_SLUG
        ? `${getAppBaseUrl()}/api/github/install/callback?installation_id=mock-${Date.now()}&state=${state}`
        : null);

    if (!url) {
      return NextResponse.json(
        {
          error:
            "GITHUB_APP_SLUG is not configured. Set it to enable GitHub App install.",
        },
        { status: 400 },
      );
    }

    await writeAuditEvent({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "github.install_started",
      entityType: "company",
      entityId: ctx.company.id,
      metadata: { url },
    });

    return NextResponse.redirect(url);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
