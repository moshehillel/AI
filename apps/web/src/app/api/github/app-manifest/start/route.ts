import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import {
  buildGitHubAppManifest,
  getGitHubAppManifestFormAction,
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
  const action = getGitHubAppManifestFormAction(org);
  const manifestJson = JSON.stringify(manifest);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Register Automation Studio GitHub App</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }
    .muted { color: #666; }
  </style>
</head>
<body>
  <h1>Register GitHub App</h1>
  <p class="muted">Redirecting to GitHub to create the Automation Studio app with pre-filled permissions…</p>
  <p class="muted">You must be signed into GitHub as the account or org owner that should own the app.</p>
  <form id="manifest-form" action="${action}?state=${state}" method="post">
    <input type="hidden" name="manifest" id="manifest" />
    <noscript>
      <p>JavaScript is required. Enable JS and reload, or create the app manually using docs/github-app-setup.md.</p>
      <button type="submit">Continue to GitHub</button>
    </noscript>
  </form>
  <script>
    document.getElementById("manifest").value = ${JSON.stringify(manifestJson)};
    document.getElementById("manifest-form").submit();
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
