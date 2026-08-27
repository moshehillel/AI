export type GitHubAppManifest = {
  name: string;
  url: string;
  hook_attributes: {
    url: string;
    active?: boolean;
  };
  redirect_url: string;
  callback_urls: string[];
  setup_url?: string;
  description?: string;
  public?: boolean;
  default_permissions: Record<string, "read" | "write">;
  default_events: string[];
};

export type GitHubAppManifestConversion = {
  id: number;
  slug: string;
  client_id: string;
  client_secret: string;
  webhook_secret: string;
  pem: string;
  html_url?: string;
};

export function getGitHubAppManifestRedirectUrl(org?: string) {
  if (org) {
    return `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps`;
  }
  return "https://github.com/settings/apps";
}

export function buildGitHubAppManifest(input: {
  appUrl: string;
  appName?: string;
  org?: string;
  /** Override post-create redirect. Use github.com URL for NetFree / no-callback flows. */
  redirectUrl?: string;
}): GitHubAppManifest {
  const base = input.appUrl.replace(/\/$/, "");
  return {
    name: input.appName ?? "Automation Studio",
    url: base,
    description:
      "Automation Studio — AI-assisted change requests with branch/PR workflows.",
    public: false,
    hook_attributes: {
      url: `${base}/api/webhooks/github`,
      active: true,
    },
    redirect_url:
      input.redirectUrl ?? `${base}/api/github/app-manifest/callback`,
    callback_urls: [`${base}/api/github/install/callback`],
    setup_url: `${base}/api/github/install/callback`,
    default_permissions: {
      contents: "write",
      pull_requests: "write",
      statuses: "read",
      checks: "read",
      administration: "read",
    },
    default_events: ["pull_request", "check_suite", "check_run", "status"],
  };
}

function escapeHtmlAttr(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** Self-contained HTML that POSTs the manifest to GitHub (no Railway / localhost / JS required). */
export function buildGitHubAppManifestStartHtml(input: {
  manifest: GitHubAppManifest;
  org?: string;
  state?: string;
}) {
  const action = getGitHubAppManifestFormAction(input.org);
  const state = input.state ?? "";
  const manifestJson = JSON.stringify(input.manifest);
  const manifestValue = escapeHtmlAttr(manifestJson);
  const query = state ? `?state=${encodeURIComponent(state)}` : "";
  const orgLabel = input.org ? `organization <strong>${input.org}</strong>` : "your GitHub account";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <title>Register Automation Studio GitHub App</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
    .steps { background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 1rem 1.25rem; margin: 1.5rem 0; }
    .steps ol { margin: 0.5rem 0 0; padding-left: 1.25rem; }
    .muted { color: #666; }
    code { background: #f4f4f4; padding: 0.1rem 0.35rem; border-radius: 4px; }
    button { font: inherit; font-weight: 600; background: #24292f; color: #fff; border: none; border-radius: 6px; padding: 0.65rem 1.25rem; cursor: pointer; margin-top: 0.5rem; }
    button:hover { background: #32383f; }
  </style>
</head>
<body>
  <h1>Register GitHub App</h1>
  <div class="steps">
    <strong>How to use this file</strong>
    <ol>
      <li>Save this file as <code>register-github-app.html</code> (not <code>.txt</code>).</li>
      <li>Right-click the file → <strong>Open with</strong> → Chrome or Edge.</li>
      <li>Click <strong>Continue to GitHub</strong> below (no auto-redirect — you must click).</li>
      <li>Sign into GitHub as ${orgLabel} owner if prompted; review the app and click <strong>Create GitHub App</strong>.</li>
      <li>Copy the one-time <code>code</code> from the redirect URL and paste it to the cloud agent (or run <code>pnpm register:github-app -- --code=…</code>).</li>
    </ol>
  </div>
  <p class="muted">If the button does not work (NetFree blocks form POST), create the app manually — see <code>docs/github-app-setup.md</code> Option D.</p>
  <form action="${action}${query}" method="post">
    <input type="hidden" name="manifest" value="${manifestValue}" />
    <button type="submit">Continue to GitHub</button>
  </form>
</body>
</html>`;
}

export function getGitHubAppManifestFormAction(org?: string) {
  if (org) {
    return `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new`;
  }
  return "https://github.com/settings/apps/new";
}

export async function convertGitHubAppManifestCode(
  code: string,
): Promise<GitHubAppManifestConversion> {
  const response = await fetch(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "automation-studio",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `GitHub manifest conversion failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }

  const data = JSON.parse(text) as GitHubAppManifestConversion;
  if (!data.id || !data.pem || !data.client_id) {
    throw new Error("GitHub manifest conversion returned incomplete credentials");
  }
  return data;
}

export function manifestToEnvVars(
  creds: GitHubAppManifestConversion,
): Record<string, string> {
  return {
    GITHUB_APP_ID: String(creds.id),
    GITHUB_APP_SLUG: creds.slug,
    GITHUB_APP_CLIENT_ID: creds.client_id,
    GITHUB_APP_CLIENT_SECRET: creds.client_secret,
    GITHUB_APP_WEBHOOK_SECRET: creds.webhook_secret,
    GITHUB_APP_PRIVATE_KEY: creds.pem.replace(/\n/g, "\\n"),
    GITHUB_MOCK: "0",
  };
}
