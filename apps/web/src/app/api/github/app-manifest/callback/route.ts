import { NextResponse } from "next/server";
import {
  convertGitHubAppManifestCode,
  manifestToEnvVars,
} from "@automation-studio/github";
import { applyGitHubAppCredentialsToRailway } from "@/lib/railway-variables";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(
      new URL("/admin?github=manifest_missing_code", request.url),
    );
  }

  try {
    const creds = await convertGitHubAppManifestCode(code);
    const variables = manifestToEnvVars(creds);

    if (process.env.RAILWAY_API_TOKEN) {
      await applyGitHubAppCredentialsToRailway(variables);
    }

    const params = new URLSearchParams({
      github: "app_registered",
      slug: creds.slug,
    });
    return NextResponse.redirect(new URL(`/admin?${params}`, request.url));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Manifest conversion failed";
    console.error("GitHub app manifest callback failed:", message);
    return NextResponse.redirect(
      new URL(
        `/admin?github=manifest_failed&error=${encodeURIComponent(message)}`,
        request.url,
      ),
    );
  }
}
