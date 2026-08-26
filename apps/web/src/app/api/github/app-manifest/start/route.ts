import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import {
  buildGitHubAppManifest,
  buildGitHubAppManifestStartHtml,
} from "@automation-studio/github";

export async function GET() {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const org = process.env.GITHUB_APP_ORG;
  const manifest = buildGitHubAppManifest({
    appUrl,
    appName: process.env.GITHUB_APP_NAME ?? "Automation Studio",
    org,
  });
  const state = randomBytes(16).toString("hex");
  const html = buildGitHubAppManifestStartHtml({ manifest, org, state });

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
